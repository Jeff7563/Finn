-- ============================================================================
-- FINN Migration: Slip Replacement & Binary Repair Audit Trail
-- Migration: 20260924000000_slip_replacement_and_binary_repair.sql
--
-- 1. Extends storage_binary_events allowed actions to support binary repair:
--    restore_requested, restore_completed, restore_failed, external_missing_detected.
-- 2. Creates append-only transaction_replacement_events audit table for
--    slip reuse after transaction void.
-- 3. Implements atomic RPC replace_voided_slip_transaction.
-- 4. Hardens restore_transaction RPC to fail closed if an active replacement exists.
--
-- IMPORTANT: THIS MIGRATION IS GENERATED FOR OPERATOR AUDIT. DO NOT APPLY TO
-- PRODUCTION WITHOUT EXPLICIT OPERATOR APPROVAL.
-- ============================================================================

-- ============================================================================
-- 1. EXTEND storage_binary_events ALLOWED ACTIONS
-- ============================================================================
ALTER TABLE public.storage_binary_events
    DROP CONSTRAINT IF EXISTS storage_binary_events_action_check;

ALTER TABLE public.storage_binary_events
    ADD CONSTRAINT storage_binary_events_action_check
    CHECK (action IN (
        'prune_requested',
        'prune_completed',
        'prune_failed',
        'pin',
        'unpin',
        'restore_requested',
        'restore_completed',
        'restore_failed',
        'external_missing_detected'
    ));

-- ============================================================================
-- 2. REPLACEMENT AUDIT TABLE: public.transaction_replacement_events
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.transaction_replacement_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    slip_id             UUID NOT NULL REFERENCES public.slips(id) ON DELETE RESTRICT,
    old_transaction_id  UUID NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
    new_transaction_id  UUID NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
    reason              TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_different_transactions CHECK (old_transaction_id <> new_transaction_id),
    CONSTRAINT chk_transaction_replacement_events_reason
        CHECK (length(trim(reason)) > 0 AND length(reason) <= 500),
    CONSTRAINT uq_transaction_replacement_old_tx UNIQUE (old_transaction_id),
    CONSTRAINT uq_transaction_replacement_new_tx UNIQUE (new_transaction_id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_transaction_replacement_events_reason'
    ) THEN
        ALTER TABLE public.transaction_replacement_events
            ADD CONSTRAINT chk_transaction_replacement_events_reason
            CHECK (length(trim(reason)) > 0 AND length(reason) <= 500);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tx_replacement_user_id
    ON public.transaction_replacement_events(user_id);

CREATE INDEX IF NOT EXISTS idx_tx_replacement_slip_id
    ON public.transaction_replacement_events(slip_id);

CREATE INDEX IF NOT EXISTS idx_tx_replacement_created_at
    ON public.transaction_replacement_events(created_at);

-- Row Level Security
ALTER TABLE public.transaction_replacement_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transaction_replacement_events_select_own"
    ON public.transaction_replacement_events;

CREATE POLICY "transaction_replacement_events_select_own"
    ON public.transaction_replacement_events FOR SELECT
    USING (auth.uid() = user_id);

-- Direct mutations revoked from browser clients; RPC/service_role only
REVOKE INSERT, UPDATE, DELETE ON public.transaction_replacement_events FROM authenticated, anon, PUBLIC;
GRANT SELECT ON public.transaction_replacement_events TO authenticated;

-- Cross-user ownership validation trigger on transaction_replacement_events
CREATE OR REPLACE FUNCTION public.validate_transaction_replacement_event_ownership()
RETURNS TRIGGER AS $$
DECLARE
    v_slip_user_id UUID;
    v_old_tx_user_id UUID;
    v_new_tx_user_id UUID;
BEGIN
    SELECT user_id INTO v_slip_user_id FROM public.slips WHERE id = NEW.slip_id;
    IF v_slip_user_id IS NULL OR v_slip_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Cross-user integrity violation: slip % does not belong to user %',
            NEW.slip_id, NEW.user_id;
    END IF;

    SELECT user_id INTO v_old_tx_user_id FROM public.transactions WHERE id = NEW.old_transaction_id;
    IF v_old_tx_user_id IS NULL OR v_old_tx_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Cross-user integrity violation: old transaction % does not belong to user %',
            NEW.old_transaction_id, NEW.user_id;
    END IF;

    SELECT user_id INTO v_new_tx_user_id FROM public.transactions WHERE id = NEW.new_transaction_id;
    IF v_new_tx_user_id IS NULL OR v_new_tx_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Cross-user integrity violation: new transaction % does not belong to user %',
            NEW.new_transaction_id, NEW.user_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_validate_transaction_replacement_event_ownership
    ON public.transaction_replacement_events;

CREATE TRIGGER trg_validate_transaction_replacement_event_ownership
    BEFORE INSERT OR UPDATE ON public.transaction_replacement_events
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_transaction_replacement_event_ownership();

-- ============================================================================
-- 3. ATOMIC RPC: replace_voided_slip_transaction
-- ============================================================================
CREATE OR REPLACE FUNCTION public.replace_voided_slip_transaction(
    p_user_id UUID,
    p_old_transaction_id UUID,
    p_slip_id UUID,
    p_reason TEXT,
    p_tx_type TEXT,
    p_amount NUMERIC,
    p_currency TEXT,
    p_transaction_date TIMESTAMPTZ,
    p_description TEXT,
    p_note TEXT,
    p_from_account_id UUID,
    p_to_account_id UUID,
    p_category_id UUID,
    p_merchant_id UUID,
    p_person_id UUID,
    p_reference_number TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_caller_uid UUID;
    v_caller_role TEXT;
    v_is_service_role BOOLEAN := false;
    v_trimmed_reason TEXT;
    v_slip RECORD;
    v_old_tx RECORD;
    v_new_tx_id UUID;
    v_event_id UUID;
    v_evidence_tx_id UUID;
    v_has_canonical_evidence BOOLEAN := false;
BEGIN
    -- 1. Caller Authentication & Authorization
    v_caller_uid := auth.uid();
    BEGIN
        v_caller_role := COALESCE(
            current_setting('request.jwt.claim.role', true),
            (SELECT auth.jwt() ->> 'role'),
            ''
        );
    EXCEPTION WHEN OTHERS THEN
        v_caller_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    END;

    v_is_service_role := (
        v_caller_role = 'service_role'
        OR current_user = 'service_role'
        OR session_user = 'service_role'
    );

    IF v_caller_uid IS NOT NULL THEN
        IF v_caller_uid != p_user_id THEN
            RAISE EXCEPTION 'Access denied: user_id does not match authenticated user';
        END IF;
    ELSIF v_is_service_role THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'Access denied: unauthenticated caller';
    END IF;

    -- 2. Validate reason
    v_trimmed_reason := trim(COALESCE(p_reason, ''));
    IF v_trimmed_reason IS NULL OR length(v_trimmed_reason) = 0 THEN
        RAISE EXCEPTION 'Replacement reason is required';
    END IF;
    IF length(v_trimmed_reason) > 500 THEN
        RAISE EXCEPTION 'Replacement reason cannot exceed 500 characters';
    END IF;

    -- 3. Lock Slip and Old Transaction (Concurrency & Atomicity)
    SELECT * INTO v_slip
    FROM public.slips
    WHERE id = p_slip_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Slip % not found or does not belong to user %', p_slip_id, p_user_id;
    END IF;

    SELECT * INTO v_old_tx
    FROM public.transactions
    WHERE id = p_old_transaction_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Old transaction % not found or does not belong to user %', p_old_transaction_id, p_user_id;
    END IF;

    -- 4. Old transaction MUST be voided
    IF v_old_tx.voided_at IS NULL THEN
        RAISE EXCEPTION 'Cannot replace active transaction %: only voided transactions may be replaced (สามารถสร้างรายการทดแทนได้เฉพาะรายการที่ถูกยกเลิก (Voided) แล้วเท่านั้น)', p_old_transaction_id;
    END IF;

    -- 5. Lock canonical transaction_evidence row for this slip if it exists
    SELECT transaction_id INTO v_evidence_tx_id
    FROM public.transaction_evidence
    WHERE slip_id = p_slip_id
    FOR UPDATE;

    IF FOUND THEN
        v_has_canonical_evidence := true;
    END IF;

    -- 6. Canonical Link Safety Validation
    -- A. If slip is canonically linked to another transaction -> FAIL CLOSED
    IF v_slip.linked_transaction_id IS NOT NULL AND v_slip.linked_transaction_id <> p_old_transaction_id THEN
        RAISE EXCEPTION 'สลิปนี้เชื่อมโยงกับรายการอื่นอยู่แล้ว ไม่สามารถใช้สร้างรายการทดแทนสำหรับรายการนี้ได้ (Slip % is canonically linked to transaction %)',
            p_slip_id, v_slip.linked_transaction_id;
    END IF;

    -- B. If canonical transaction_evidence belongs to another transaction -> FAIL CLOSED
    IF v_has_canonical_evidence AND v_evidence_tx_id <> p_old_transaction_id THEN
        RAISE EXCEPTION 'สลิปนี้มีหลักฐานเชื่อมโยงกับรายการอื่นอยู่แล้ว ไม่สามารถใช้สร้างรายการทดแทนสำหรับรายการนี้ได้ (Slip evidence belongs to transaction %)',
            v_evidence_tx_id;
    END IF;

    -- C. Legacy compatibility check:
    -- If slip has no canonical link and no transaction_evidence row exists,
    -- old_transaction.source_slip_id = p_slip_id may be accepted as legacy evidence.
    IF v_slip.linked_transaction_id IS NULL AND NOT v_has_canonical_evidence THEN
        IF v_old_tx.source_slip_id IS DISTINCT FROM p_slip_id THEN
            RAISE EXCEPTION 'สามารถสร้างรายการทดแทนได้เฉพาะรายการที่มีหลักฐานสลิปเท่านั้น (Old transaction % has no association with slip %)',
                p_old_transaction_id, p_slip_id;
        END IF;
    END IF;

    -- D. One Canonical Slip -> One Active Transaction:
    -- Ensure no other ACTIVE transaction claims this slip through
    -- slips.linked_transaction_id, transaction_evidence.slip_id, or transactions.source_slip_id
    IF EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.user_id = p_user_id
          AND t.id <> p_old_transaction_id
          AND t.voided_at IS NULL
          AND (
              t.id = v_slip.linked_transaction_id
              OR t.id = v_evidence_tx_id
              OR t.source_slip_id = p_slip_id
          )
    ) THEN
        RAISE EXCEPTION 'สลิปนี้ถูกเชื่อมโยงกับรายการที่กำลังใช้งานอยู่แล้ว (Slip % is already linked to another active transaction)', p_slip_id;
    END IF;

    -- 7. Verify old transaction has not already been replaced
    IF EXISTS (
        SELECT 1 FROM public.transaction_replacement_events
        WHERE old_transaction_id = p_old_transaction_id
    ) THEN
        RAISE EXCEPTION 'รายการนี้มีรายการทดแทนอยู่แล้ว (Transaction % has already been replaced)', p_old_transaction_id;
    END IF;

    -- 7. Validate corrected transaction payload
    IF p_tx_type IS NULL OR p_tx_type NOT IN ('income', 'expense', 'transfer') THEN
        RAISE EXCEPTION 'Invalid transaction type %: replacement only allows income, expense, or transfer', p_tx_type;
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid amount: must be greater than 0';
    END IF;
    IF p_amount > 999999999999.99 THEN
        RAISE EXCEPTION 'Invalid amount: exceeds maximum allowable limit';
    END IF;

    IF p_transaction_date IS NULL THEN
        RAISE EXCEPTION 'Transaction date is required';
    END IF;

    IF p_tx_type = 'transfer' THEN
        IF p_from_account_id IS NULL OR p_to_account_id IS NULL THEN
            RAISE EXCEPTION 'Transfer requires both from_account_id and to_account_id';
        END IF;
        IF p_from_account_id = p_to_account_id THEN
            RAISE EXCEPTION 'Source and destination accounts must not be identical';
        END IF;
    ELSIF p_tx_type = 'expense' THEN
        IF p_from_account_id IS NULL THEN
            RAISE EXCEPTION 'Expense requires from_account_id';
        END IF;
        IF p_to_account_id IS NOT NULL THEN
            RAISE EXCEPTION 'Expense must not have to_account_id';
        END IF;
    ELSIF p_tx_type = 'income' THEN
        IF p_to_account_id IS NULL THEN
            RAISE EXCEPTION 'Income requires to_account_id';
        END IF;
        IF p_from_account_id IS NOT NULL THEN
            RAISE EXCEPTION 'Income must not have from_account_id';
        END IF;
    END IF;

    -- Verify ownership of referenced entities
    IF p_from_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = p_from_account_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Foreign source account does not belong to user %', p_user_id;
    END IF;

    IF p_to_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.accounts WHERE id = p_to_account_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Foreign destination account does not belong to user %', p_user_id;
    END IF;

    IF p_category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.categories WHERE id = p_category_id AND (user_id = p_user_id OR is_system = true)
    ) THEN
        RAISE EXCEPTION 'Foreign category does not belong to user %', p_user_id;
    END IF;

    IF p_merchant_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.merchants WHERE id = p_merchant_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Foreign merchant does not belong to user %', p_user_id;
    END IF;

    IF p_person_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.people WHERE id = p_person_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Foreign person does not belong to user %', p_user_id;
    END IF;

    -- 8. Create NEW active transaction
    INSERT INTO public.transactions (
        user_id,
        type,
        amount,
        currency,
        transaction_date,
        description,
        note,
        from_account_id,
        to_account_id,
        category_id,
        merchant_id,
        person_id,
        source,
        source_slip_id,
        reference_number,
        confidence,
        review_status
    ) VALUES (
        p_user_id,
        p_tx_type,
        p_amount,
        COALESCE(p_currency, 'THB'),
        p_transaction_date,
        p_description,
        p_note,
        p_from_account_id,
        p_to_account_id,
        p_category_id,
        p_merchant_id,
        p_person_id,
        'slip',
        p_slip_id,
        p_reference_number,
        1.0,
        'confirmed'
    )
    RETURNING id INTO v_new_tx_id;

    -- 9. Move canonical slip evidence association from old tx -> new tx
    IF v_has_canonical_evidence THEN
        UPDATE public.transaction_evidence
        SET transaction_id = v_new_tx_id
        WHERE slip_id = p_slip_id;
    ELSE
        INSERT INTO public.transaction_evidence (
            user_id,
            transaction_id,
            evidence_type,
            slip_id
        ) VALUES (
            p_user_id,
            v_new_tx_id,
            'slip',
            p_slip_id
        );
    END IF;

    -- 10. Update public.slips.linked_transaction_id -> new tx
    UPDATE public.slips
    SET linked_transaction_id = v_new_tx_id,
        status = 'created'
    WHERE id = p_slip_id AND user_id = p_user_id;

    -- 11. Append transaction_replacement_events row
    INSERT INTO public.transaction_replacement_events (
        user_id,
        slip_id,
        old_transaction_id,
        new_transaction_id,
        reason,
        created_at
    ) VALUES (
        p_user_id,
        p_slip_id,
        p_old_transaction_id,
        v_new_tx_id,
        v_trimmed_reason,
        now()
    )
    RETURNING id INTO v_event_id;

    RETURN jsonb_build_object(
        'success', true,
        'new_transaction_id', v_new_tx_id,
        'old_transaction_id', p_old_transaction_id,
        'slip_id', p_slip_id,
        'event_id', v_event_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_voided_slip_transaction(
    UUID, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_voided_slip_transaction(
    UUID, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_voided_slip_transaction(
    UUID, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_voided_slip_transaction(
    UUID, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT
) TO service_role;

-- ============================================================================
-- 4. HARDEN restore_transaction: FAIL CLOSED IF REPLACEMENT EXISTS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.restore_transaction(
    p_user_id UUID,
    p_transaction_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_caller_uid UUID;
    v_caller_role TEXT;
    v_is_service_role BOOLEAN := false;
    v_trimmed_reason TEXT;
    v_tx RECORD;
    v_replacement RECORD;
    v_new_tx RECORD;
    v_event RECORD;
BEGIN
    -- 1. Caller Authentication & Authorization
    v_caller_uid := auth.uid();

    BEGIN
        v_caller_role := COALESCE(
            current_setting('request.jwt.claim.role', true),
            (SELECT auth.jwt() ->> 'role'),
            ''
        );
    EXCEPTION WHEN OTHERS THEN
        v_caller_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    END;

    v_is_service_role := (
        v_caller_role = 'service_role'
        OR current_user = 'service_role'
        OR session_user = 'service_role'
    );

    IF v_caller_uid IS NOT NULL THEN
        IF v_caller_uid != p_user_id THEN
            RAISE EXCEPTION 'Access denied: user_id does not match authenticated user';
        END IF;
    ELSIF v_is_service_role THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'Access denied: unauthenticated caller';
    END IF;

    -- 2. Validate reason (optional for restore, max 500 chars)
    v_trimmed_reason := trim(COALESCE(p_reason, ''));
    IF length(v_trimmed_reason) > 500 THEN
        RAISE EXCEPTION 'Restore reason cannot exceed 500 characters';
    END IF;

    -- 3. Concurrency Lock & Ownership
    SELECT * INTO v_tx
    FROM public.transactions
    WHERE id = p_transaction_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaction % not found or does not belong to user %', p_transaction_id, p_user_id;
    END IF;

    -- 4. Idempotency Check: Already active (not voided)
    IF v_tx.voided_at IS NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_active', true,
            'transaction_id', p_transaction_id
        );
    END IF;

    -- 5. Restore Safety Check: Fail closed if transaction has been replaced
    SELECT * INTO v_replacement
    FROM public.transaction_replacement_events
    WHERE old_transaction_id = p_transaction_id;

    IF FOUND THEN
        SELECT * INTO v_new_tx
        FROM public.transactions
        WHERE id = v_replacement.new_transaction_id;

        IF v_new_tx.voided_at IS NULL THEN
            RAISE EXCEPTION 'ไม่สามารถคืนรายการนี้ได้ เนื่องจากมีรายการทดแทนที่กำลังใช้งานอยู่ กรุณายกเลิกรายการทดแทนก่อน';
        ELSE
            RAISE EXCEPTION 'ไม่สามารถคืนรายการนี้ได้ เนื่องจากรายการนี้ถูกแทนที่ไปแล้ว (กรุณาจัดการที่รายการทดแทนล่าสุด)';
        END IF;
    END IF;

    -- 6. Restore Transaction (Clear void state with trusted RPC context)
    PERFORM set_config('app.allow_void_mutation', 'true', true);

    UPDATE public.transactions
    SET
        voided_at = NULL,
        voided_by = NULL,
        void_reason = NULL,
        updated_at = now()
    WHERE id = p_transaction_id
    RETURNING * INTO v_tx;

    PERFORM set_config('app.allow_void_mutation', 'false', true);

    -- 7. Insert Append-Only Audit Event
    INSERT INTO public.transaction_void_events (
        user_id,
        transaction_id,
        action,
        reason,
        created_at
    ) VALUES (
        p_user_id,
        p_transaction_id,
        'restore',
        NULLIF(v_trimmed_reason, ''),
        now()
    ) RETURNING * INTO v_event;

    RETURN jsonb_build_object(
        'success', true,
        'already_active', false,
        'transaction_id', p_transaction_id,
        'event_id', v_event.id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_transaction(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_transaction(UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.restore_transaction(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_transaction(UUID, UUID, TEXT) TO service_role;

-- ============================================================================
-- 5. OPERATOR VERIFICATION SQL (Section E)
-- ============================================================================
/*
WITH operator_checks AS (
    -- 1. transaction_replacement_events table exists
    SELECT
        '1. transaction_replacement_events table exists' AS check_name,
        EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'transaction_replacement_events'
        ) AS passed,
        'transaction_replacement_events table created for auditable slip replacement' AS details
    UNION ALL
    -- 2. transaction_evidence column evidence_type exists
    SELECT
        '2. transaction_evidence column evidence_type exists',
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'transaction_evidence' AND column_name = 'evidence_type'
        ),
        'transaction_evidence schema adheres to Phase 3 evidence_type column'
    UNION ALL
    -- 3. transaction_replacement_events reason CHECK exists
    SELECT
        '3. transaction_replacement_events reason CHECK exists',
        EXISTS (
            SELECT 1 FROM pg_constraint con
            JOIN pg_class c ON con.conrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public' AND c.relname = 'transaction_replacement_events' AND con.contype = 'c'
              AND pg_get_constraintdef(con.oid) LIKE '%length(trim(reason))%'
        ),
        'transaction_replacement_events enforces length(trim(reason)) > 0 AND length(reason) <= 500'
    UNION ALL
    -- 4. RPC replace_voided_slip_transaction exists and is SECURITY DEFINER
    SELECT
        '4. replace_voided_slip_transaction is SECURITY DEFINER',
        EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'replace_voided_slip_transaction' AND p.prosecdef = true
        ),
        'replace_voided_slip_transaction function exists with SECURITY DEFINER'
    UNION ALL
    -- 5. RPC execute denied to anon and PUBLIC
    SELECT
        '5. RPC execute denied to anon/PUBLIC',
        NOT EXISTS (
            SELECT 1 FROM information_schema.routine_privileges
            WHERE routine_schema = 'public' AND routine_name = 'replace_voided_slip_transaction'
              AND grantee IN ('anon', 'PUBLIC') AND privilege_type = 'EXECUTE'
        ),
        'Execution denied to anon and PUBLIC roles'
    UNION ALL
    -- 6. RPC execute allowed to authenticated and service_role
    SELECT
        '6. RPC execute allowed to authenticated and service_role',
        EXISTS (
            SELECT 1 FROM information_schema.routine_privileges
            WHERE routine_schema = 'public' AND routine_name = 'replace_voided_slip_transaction'
              AND grantee = 'authenticated' AND privilege_type = 'EXECUTE'
        ),
        'Execution granted to authenticated role'
    UNION ALL
    -- 7. Row Level Security enabled on transaction_replacement_events
    SELECT
        '7. Row Level Security enabled on transaction_replacement_events',
        EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public' AND c.relname = 'transaction_replacement_events' AND c.relrowsecurity = true
        ),
        'RLS is enabled to enforce owner-only read isolation'
    UNION ALL
    -- 8. Direct mutations denied on transaction_replacement_events
    SELECT
        '8. Direct mutations denied on transaction_replacement_events',
        NOT EXISTS (
            SELECT 1 FROM information_schema.role_table_grants
            WHERE table_schema = 'public'
              AND table_name = 'transaction_replacement_events'
              AND grantee IN ('authenticated', 'anon', 'PUBLIC')
              AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
        ),
        'No direct INSERT, UPDATE, DELETE permissions for client roles; RPC only'
    UNION ALL
    -- 9. Foreign keys enforce ON DELETE RESTRICT
    SELECT
        '9. Foreign keys enforce ON DELETE RESTRICT',
        (
            SELECT COUNT(*) = 3 FROM pg_constraint con
            JOIN pg_class c ON con.conrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public'
              AND c.relname = 'transaction_replacement_events'
              AND con.contype = 'f'
              AND con.confdeltype = 'r'
        ),
        'slip_id, old_transaction_id, and new_transaction_id all enforce ON DELETE RESTRICT'
    UNION ALL
    -- 10. Uniqueness on old_transaction_id
    SELECT
        '10. Uniqueness on old_transaction_id',
        EXISTS (
            SELECT 1 FROM pg_constraint con
            JOIN pg_class c ON con.conrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public'
              AND c.relname = 'transaction_replacement_events'
              AND con.conname = 'uq_transaction_replacement_old_tx'
        ),
        'UNIQUE(old_transaction_id) prevents multiple replacements for a single voided transaction'
    UNION ALL
    -- 11. Uniqueness on new_transaction_id
    SELECT
        '11. Uniqueness on new_transaction_id',
        EXISTS (
            SELECT 1 FROM pg_constraint con
            JOIN pg_class c ON con.conrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public'
              AND c.relname = 'transaction_replacement_events'
              AND con.conname = 'uq_transaction_replacement_new_tx'
        ),
        'UNIQUE(new_transaction_id) prevents a replacement transaction from replacing multiple old transactions'
    UNION ALL
    -- 12. Ownership integrity trigger exists
    SELECT
        '12. Ownership integrity trigger exists',
        EXISTS (
            SELECT 1 FROM information_schema.triggers
            WHERE event_object_schema = 'public'
              AND event_object_table = 'transaction_replacement_events'
              AND trigger_name = 'trg_validate_transaction_replacement_event_ownership'
        ),
        'Trigger validates that slip_id, old_tx, and new_tx belong to the same user'
    UNION ALL
    -- 13. Function definition references evidence_type and not source_type
    SELECT
        '13. Function definition references evidence_type and not source_type',
        EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'replace_voided_slip_transaction'
              AND pg_get_functiondef(p.oid) LIKE '%evidence_type%'
              AND pg_get_functiondef(p.oid) NOT LIKE '%source_type%'
        ),
        'replace_voided_slip_transaction references evidence_type and does NOT reference source_type'
    UNION ALL
    -- 14. storage_binary_events supports restore actions
    SELECT
        '14. storage_binary_events action check includes restore actions',
        EXISTS (
            SELECT 1 FROM pg_constraint con
            JOIN pg_class c ON con.conrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public'
              AND c.relname = 'storage_binary_events'
              AND con.contype = 'c'
              AND pg_get_constraintdef(con.oid) LIKE '%restore_requested%'
              AND pg_get_constraintdef(con.oid) LIKE '%restore_completed%'
              AND pg_get_constraintdef(con.oid) LIKE '%restore_failed%'
        ),
        'storage_binary_events supports restore_requested, restore_completed, restore_failed'
)
SELECT check_name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status, details
FROM operator_checks;
*/
