-- Migration: Atomic Slip Confirmation, Foreign Key Integrity & Multi-Table Realtime Sync

-- 1. Ensure REPLICA IDENTITY FULL for slips, transactions, and accounts
-- This ensures that UPDATE and DELETE payloads contain full rows for Realtime RLS and filtering.
ALTER TABLE public.slips REPLICA IDENTITY FULL;
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
ALTER TABLE public.accounts REPLICA IDENTITY FULL;

-- 2. Concurrency & Idempotency: Unique constraints
-- Ensures 1:1 durable mapping and prevents duplicate transactions for a single slip
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_source_slip_id_unique
ON public.transactions(source_slip_id)
WHERE source_slip_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_slips_linked_transaction_id_unique
ON public.slips(linked_transaction_id)
WHERE linked_transaction_id IS NOT NULL;

-- 3. Foreign Key Integrity on transactions.source_slip_id
-- Ensures referential integrity without circular delete cascade destruction
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_transactions_source_slip'
          AND table_name = 'transactions'
    ) THEN
        ALTER TABLE public.transactions
        ADD CONSTRAINT fk_transactions_source_slip
        FOREIGN KEY (source_slip_id)
        REFERENCES public.slips(id)
        ON DELETE SET NULL;
    END IF;
END $$;

-- 4. Atomic PostgreSQL RPC for Slip Confirmation
-- Atomically locks slip, verifies ownership, creates transaction, and updates slip status to 'created'
CREATE OR REPLACE FUNCTION public.confirm_slip_transaction(
    p_slip_id UUID,
    p_user_id UUID,
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
    p_reference_number TEXT,
    p_confidence NUMERIC,
    p_review_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_slip RECORD;
    v_existing_tx RECORD;
    v_new_tx_id UUID;
    v_caller_uid UUID;
    v_caller_role TEXT;
    v_is_service_role BOOLEAN := false;
    v_review_status TEXT;
BEGIN
    -- 1. Caller Authentication & Fail-Closed Authorization
    -- Normal authenticated calls: auth.uid() MUST NOT be null and MUST equal p_user_id.
    -- Service role calls: explicitly verified via JWT role claim or current/session role.
    -- Anonymous or unverified callers are ALWAYS rejected.
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
        -- Explicitly verified service_role caller allowed
        NULL;
    ELSE
        -- Fail closed on NULL caller or unverified context
        RAISE EXCEPTION 'Access denied: unauthenticated caller';
    END IF;

    -- 2. Restrict Confirmation Input Domain
    -- 2.1 Only workflow-appropriate transaction types allowed
    IF p_tx_type IS NULL OR p_tx_type NOT IN ('income', 'expense', 'transfer') THEN
        RAISE EXCEPTION 'Invalid transaction type %: confirmation only allows income, expense, or transfer', p_tx_type;
    END IF;

    -- 2.2 Only workflow-appropriate review statuses allowed
    v_review_status := COALESCE(p_review_status, 'confirmed');
    IF v_review_status NOT IN ('confirmed', 'corrected') THEN
        RAISE EXCEPTION 'Invalid review_status %: confirmation only allows confirmed or corrected', p_review_status;
    END IF;

    -- 2.3 Amount validation: positive and bounded
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid amount: must be greater than 0';
    END IF;
    IF p_amount > 999999999999.99 THEN
        RAISE EXCEPTION 'Invalid amount: exceeds maximum allowable limit';
    END IF;

    -- 2.4 Transaction date validation
    IF p_transaction_date IS NULL THEN
        RAISE EXCEPTION 'Transaction date is required';
    END IF;

    -- 2.5 Appropriate account requirements
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

    -- 3. Ownership Defense-in-Depth
    -- Validate that all referenced entities belong to p_user_id (or system category)
    IF p_from_account_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.accounts
            WHERE id = p_from_account_id AND user_id = p_user_id
        ) THEN
            RAISE EXCEPTION 'Security violation: foreign source account does not belong to user %', p_user_id;
        END IF;
    END IF;

    IF p_to_account_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.accounts
            WHERE id = p_to_account_id AND user_id = p_user_id
        ) THEN
            RAISE EXCEPTION 'Security violation: foreign destination account does not belong to user %', p_user_id;
        END IF;
    END IF;

    IF p_category_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.categories
            WHERE id = p_category_id AND (user_id = p_user_id OR is_system = true)
        ) THEN
            RAISE EXCEPTION 'Security violation: foreign category does not belong to user %', p_user_id;
        END IF;
    END IF;

    IF p_merchant_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.merchants
            WHERE id = p_merchant_id AND user_id = p_user_id
        ) THEN
            RAISE EXCEPTION 'Security violation: foreign merchant does not belong to user %', p_user_id;
        END IF;
    END IF;

    IF p_person_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.people
            WHERE id = p_person_id AND user_id = p_user_id
        ) THEN
            RAISE EXCEPTION 'Security violation: foreign person does not belong to user %', p_user_id;
        END IF;
    END IF;

    -- 4. Slip Row Locking & Ownership Check (Concurrency & Atomicity)
    SELECT * INTO v_slip
    FROM public.slips
    WHERE id = p_slip_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Slip not found or access denied';
    END IF;

    -- 5. Idempotency Check 1: slip already has linked_transaction_id
    IF v_slip.linked_transaction_id IS NOT NULL THEN
        SELECT * INTO v_existing_tx
        FROM public.transactions
        WHERE id = v_slip.linked_transaction_id AND user_id = p_user_id;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'transaction_id', v_existing_tx.id,
                'already_confirmed', true
            );
        END IF;
    END IF;

    -- 6. Idempotency Check 2: transaction already exists for this source_slip_id
    SELECT * INTO v_existing_tx
    FROM public.transactions
    WHERE source_slip_id = p_slip_id AND user_id = p_user_id;

    IF FOUND THEN
        UPDATE public.slips
        SET status = 'created',
            linked_transaction_id = v_existing_tx.id,
            processed_at = COALESCE(processed_at, pg_catalog.now())
        WHERE id = p_slip_id AND user_id = p_user_id;

        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'transaction_id', v_existing_tx.id,
            'already_confirmed', true
        );
    END IF;

    -- 7. Validate slip status (only needs_review or unlinked created slips can be confirmed)
    IF v_slip.status != 'needs_review' AND v_slip.status != 'created' THEN
        RAISE EXCEPTION 'Slip status is %; only slips in needs_review can be confirmed', v_slip.status;
    END IF;

    -- 8. Insert Transaction (1 slip -> maximum 1 transaction)
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
        COALESCE(p_confidence, 1.0),
        v_review_status
    )
    RETURNING id INTO v_new_tx_id;

    -- 9. Update slip status to 'created' (canonical production status)
    UPDATE public.slips
    SET status = 'created',
        linked_transaction_id = v_new_tx_id,
        processed_at = pg_catalog.now()
    WHERE id = p_slip_id AND user_id = p_user_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'transaction_id', v_new_tx_id,
        'already_confirmed', false
    );
END;
$$;

-- 10. Privilege Hardening: Revoke from PUBLIC and anon, grant only to authenticated and service_role
REVOKE ALL ON FUNCTION public.confirm_slip_transaction(
    UUID, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT,
    UUID, UUID, UUID, UUID, UUID, TEXT, NUMERIC, TEXT
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.confirm_slip_transaction(
    UUID, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT,
    UUID, UUID, UUID, UUID, UUID, TEXT, NUMERIC, TEXT
) FROM anon;

GRANT EXECUTE ON FUNCTION public.confirm_slip_transaction(
    UUID, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT,
    UUID, UUID, UUID, UUID, UUID, TEXT, NUMERIC, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_slip_transaction(
    UUID, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT,
    UUID, UUID, UUID, UUID, UUID, TEXT, NUMERIC, TEXT
) TO service_role;

-- 5. Realtime publication idempotency for transactions and accounts
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'transactions'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'accounts'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.accounts;
        END IF;
    END IF;
END $$;
