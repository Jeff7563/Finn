-- ============================================================================
-- FINN Migration: Transaction Void & Undo Audit Trail
-- Migration: 20260916000004_transaction_void.sql
--
-- Replaces destructive deletion of evidence-backed transactions with auditable
-- VOID and RESTORE mechanisms. Preserves all historical evidence and audit data.
-- ============================================================================

-- 1. Alter public.transactions to support soft-void audit state
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS voided_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS void_reason TEXT NULL;

-- Performance indexes for active vs voided transaction queries
CREATE INDEX IF NOT EXISTS idx_transactions_active
    ON public.transactions(user_id, transaction_date DESC)
    WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_voided
    ON public.transactions(user_id, voided_at)
    WHERE voided_at IS NOT NULL;

-- 2. Append-only audit table: public.transaction_void_events
CREATE TABLE IF NOT EXISTS public.transaction_void_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    transaction_id  UUID NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
    action          TEXT NOT NULL CHECK (action IN ('void', 'restore')),
    reason          TEXT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transaction_void_events_user_id
    ON public.transaction_void_events(user_id);

CREATE INDEX IF NOT EXISTS idx_transaction_void_events_transaction_id
    ON public.transaction_void_events(transaction_id);

CREATE INDEX IF NOT EXISTS idx_transaction_void_events_created_at
    ON public.transaction_void_events(created_at);

-- 3. Row Level Security for transaction_void_events
ALTER TABLE public.transaction_void_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users may SELECT their own events for audit display
CREATE POLICY "transaction_void_events_select_own"
    ON public.transaction_void_events FOR SELECT
    USING (auth.uid() = user_id);

-- Explicitly revoke direct INSERT, UPDATE, DELETE from browser clients.
-- All mutations must strictly go through trusted SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.transaction_void_events FROM authenticated, anon;
GRANT SELECT ON public.transaction_void_events TO authenticated;

-- 4. Cross-user integrity check on transaction_void_events
CREATE OR REPLACE FUNCTION public.validate_transaction_void_event_ownership()
RETURNS TRIGGER AS $$
DECLARE
    v_tx_user_id UUID;
BEGIN
    SELECT user_id INTO v_tx_user_id FROM public.transactions WHERE id = NEW.transaction_id;
    IF v_tx_user_id IS NULL OR v_tx_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Cross-user integrity violation: transaction % does not belong to user %',
            NEW.transaction_id, NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_validate_transaction_void_event_ownership ON public.transaction_void_events;
CREATE TRIGGER trg_validate_transaction_void_event_ownership
    BEFORE INSERT OR UPDATE ON public.transaction_void_events
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_transaction_void_event_ownership();

-- ============================================================================
-- 5. Guard against direct void-state mutations on public.transactions
-- ============================================================================
-- Rejects any change to voided_at, voided_by, or void_reason unless executing
-- through the trusted void_transaction() or restore_transaction() RPC path.
-- Ordinary updates (description, amount, category, date, etc.) remain permitted.
CREATE OR REPLACE FUNCTION public.guard_transaction_void_state_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (OLD.voided_at IS DISTINCT FROM NEW.voided_at)
           OR (OLD.voided_by IS DISTINCT FROM NEW.voided_by)
           OR (OLD.void_reason IS DISTINCT FROM NEW.void_reason) THEN
            IF COALESCE(current_setting('app.allow_void_mutation', true), 'false') <> 'true' THEN
                RAISE EXCEPTION 'Direct modification of transaction void state (voided_at, voided_by, void_reason) is prohibited. Use void_transaction() or restore_transaction() RPC.';
            END IF;
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.voided_at IS NOT NULL OR NEW.voided_by IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
            IF COALESCE(current_setting('app.allow_void_mutation', true), 'false') <> 'true' THEN
                RAISE EXCEPTION 'Direct insertion of transaction void state (voided_at, voided_by, void_reason) is prohibited. Transactions must be created active and voided via void_transaction() RPC.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_guard_transaction_void_state_mutation ON public.transactions;
CREATE TRIGGER trg_guard_transaction_void_state_mutation
    BEFORE INSERT OR UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_transaction_void_state_mutation();

-- ============================================================================
-- 6. Atomic Void RPC: void_transaction
-- ============================================================================
CREATE OR REPLACE FUNCTION public.void_transaction(
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

    -- 2. Validate reason
    v_trimmed_reason := trim(p_reason);
    IF v_trimmed_reason IS NULL OR length(v_trimmed_reason) = 0 THEN
        RAISE EXCEPTION 'Void reason is required';
    END IF;
    IF length(v_trimmed_reason) > 500 THEN
        RAISE EXCEPTION 'Void reason cannot exceed 500 characters';
    END IF;

    -- 3. Concurrency Lock & Ownership
    SELECT * INTO v_tx
    FROM public.transactions
    WHERE id = p_transaction_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaction % not found or does not belong to user %', p_transaction_id, p_user_id;
    END IF;

    -- 4. Idempotency Check: Already voided
    IF v_tx.voided_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_voided', true,
            'transaction_id', p_transaction_id,
            'voided_at', v_tx.voided_at,
            'void_reason', v_tx.void_reason
        );
    END IF;

    -- 5. Mark Transaction as Voided (with trusted RPC context)
    PERFORM set_config('app.allow_void_mutation', 'true', true);

    UPDATE public.transactions
    SET
        voided_at = now(),
        voided_by = p_user_id,
        void_reason = v_trimmed_reason,
        updated_at = now()
    WHERE id = p_transaction_id
    RETURNING * INTO v_tx;

    PERFORM set_config('app.allow_void_mutation', 'false', true);

    -- 6. Insert Append-Only Audit Event
    INSERT INTO public.transaction_void_events (
        user_id,
        transaction_id,
        action,
        reason,
        created_at
    ) VALUES (
        p_user_id,
        p_transaction_id,
        'void',
        v_trimmed_reason,
        now()
    ) RETURNING * INTO v_event;

    RETURN jsonb_build_object(
        'success', true,
        'already_voided', false,
        'transaction_id', p_transaction_id,
        'voided_at', v_tx.voided_at,
        'void_reason', v_tx.void_reason,
        'event_id', v_event.id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.void_transaction(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_transaction(UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.void_transaction(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_transaction(UUID, UUID, TEXT) TO service_role;

-- ============================================================================
-- 7. Atomic Restore RPC: restore_transaction
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

    -- 5. Restore Transaction (Clear void state with trusted RPC context)
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

    -- 6. Insert Append-Only Audit Event
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
-- 8. Operator Verification SQL Queries (Audit Invariant Validation)
-- ============================================================================
-- The following queries allow operators to verify that all database-level
-- security invariants, triggers, RPC permissions, and constraints are active.
-- Operators can execute these queries to get explicit boolean PASS/FAIL confirmations.
--
-- Query 1: Verify guard trigger exists on public.transactions
-- SELECT 
--     CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END AS status,
--     'guard trigger trg_guard_transaction_void_state_mutation exists on public.transactions' AS check_name
-- FROM information_schema.triggers
-- WHERE event_object_schema = 'public'
--   AND event_object_table = 'transactions'
--   AND trigger_name = 'trg_guard_transaction_void_state_mutation'
--   AND event_manipulation = 'UPDATE'
--   AND action_timing = 'BEFORE';
--
-- Query 2: Verify void_transaction and restore_transaction RPCs exist with SECURITY DEFINER
-- SELECT 
--     CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS status,
--     'void_transaction and restore_transaction RPCs exist with SECURITY DEFINER' AS check_name
-- FROM pg_proc p
-- JOIN pg_namespace n ON p.pronamespace = n.oid
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('void_transaction', 'restore_transaction')
--   AND p.prosecdef = true;
--
-- Query 3: Verify ROW LEVEL SECURITY is enabled on public.transaction_void_events
-- SELECT 
--     CASE WHEN relrowsecurity = true THEN 'PASS' ELSE 'FAIL' END AS status,
--     'Row Level Security enabled on public.transaction_void_events' AS check_name
-- FROM pg_class c
-- JOIN pg_namespace n ON c.relnamespace = n.oid
-- WHERE n.nspname = 'public'
--   AND c.relname = 'transaction_void_events';
--
-- Query 4: Verify direct audit event mutations (INSERT, UPDATE, DELETE) are denied
-- SELECT 
--     CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
--     'Direct INSERT, UPDATE, DELETE revoked from authenticated and anon on transaction_void_events' AS check_name
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name = 'transaction_void_events'
--   AND grantee IN ('authenticated', 'anon', 'PUBLIC')
--   AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
--
-- Query 5: Verify transaction_void_events foreign key enforces ON DELETE RESTRICT
-- SELECT 
--     CASE WHEN confdeltype = 'r' THEN 'PASS' ELSE 'FAIL' END AS status,
--     'transaction_void_events.transaction_id foreign key enforces ON DELETE RESTRICT' AS check_name
-- FROM pg_constraint con
-- JOIN pg_class c ON con.conrelid = c.oid
-- JOIN pg_namespace n ON c.relnamespace = n.oid
-- WHERE n.nspname = 'public'
--   AND c.relname = 'transaction_void_events'
--   AND con.contype = 'f'
--   AND con.confdeltype = 'r'
--   AND con.confrelid = 'public.transactions'::regclass;
--
-- Consolidated Operator Audit Verification Query:
-- WITH audit_checks AS (
--     SELECT '1. Guard Trigger on transactions' AS item,
--            EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_schema = 'public' AND event_object_table = 'transactions' AND trigger_name = 'trg_guard_transaction_void_state_mutation' AND event_manipulation = 'UPDATE' AND action_timing = 'BEFORE') AS passed,
--            'BEFORE UPDATE trigger prevents direct modification of voided_at, voided_by, void_reason' AS details
--     UNION ALL
--     SELECT '2. void_transaction RPC exists & secure',
--            EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'void_transaction' AND p.prosecdef = true),
--            'void_transaction exists as SECURITY DEFINER with restricted search_path'
--     UNION ALL
--     SELECT '3. restore_transaction RPC exists & secure',
--            EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'restore_transaction' AND p.prosecdef = true),
--            'restore_transaction exists as SECURITY DEFINER with restricted search_path'
--     UNION ALL
--     SELECT '4. Audit table RLS enabled',
--            EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = 'public' AND c.relname = 'transaction_void_events' AND c.relrowsecurity = true),
--            'ROW LEVEL SECURITY is active on transaction_void_events'
--     UNION ALL
--     SELECT '5. Direct audit event mutations denied',
--            NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'transaction_void_events' AND grantee IN ('authenticated', 'anon', 'PUBLIC') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')),
--            'No direct INSERT, UPDATE, DELETE permissions for authenticated or anon'
--     UNION ALL
--     SELECT '6. Audit FK ON DELETE RESTRICT',
--            EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class c ON con.conrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = 'public' AND c.relname = 'transaction_void_events' AND con.contype = 'f' AND con.confdeltype = 'r'),
--            'transaction_void_events.transaction_id enforces ON DELETE RESTRICT'
-- )
-- SELECT item, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status, details FROM audit_checks;

