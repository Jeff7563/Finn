-- Migration: 20260924000001_source_slip_active_uniqueness.sql
-- Production Hotfix: Active-Only source_slip_id Uniqueness & Confirm Slip Idempotency Audit
--
-- ROOT CAUSE:
-- Migration 20260915000001 created a lifetime-unique partial index on transactions(source_slip_id)
-- WHERE source_slip_id IS NOT NULL.
-- In the replacement architecture, historical voided transactions retain their source_slip_id,
-- while a new active replacement transaction is inserted with the same source_slip_id.
-- The lifetime-unique index incorrectly rejected replacement INSERTs with:
--   duplicate key value violates unique constraint "idx_transactions_source_slip_id_unique"
--
-- FIX:
-- 1. Replace the lifetime-unique index with an active-only unique index:
--    WHERE source_slip_id IS NOT NULL AND voided_at IS NULL
-- 2. Audit and harden confirm_slip_transaction idempotency fallback to only query ACTIVE transactions:
--    WHERE source_slip_id = p_slip_id AND user_id = p_user_id AND voided_at IS NULL

BEGIN;

-- 1. DROP old lifetime-unique index and RECREATE active-only unique index
DROP INDEX IF EXISTS public.idx_transactions_source_slip_id_unique;

CREATE UNIQUE INDEX idx_transactions_source_slip_id_unique
ON public.transactions(source_slip_id)
WHERE source_slip_id IS NOT NULL
  AND voided_at IS NULL;

-- 2. CREATE OR REPLACE FUNCTION public.confirm_slip_transaction
-- Audited to ensure the source_slip_id fallback query only matches ACTIVE transactions (voided_at IS NULL),
-- preventing relinking to arbitrary historical voided transactions.
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
    IF p_tx_type IS NULL OR p_tx_type NOT IN ('income', 'expense', 'transfer') THEN
        RAISE EXCEPTION 'Invalid transaction type %: confirmation only allows income, expense, or transfer', p_tx_type;
    END IF;

    v_review_status := COALESCE(p_review_status, 'confirmed');
    IF v_review_status NOT IN ('confirmed', 'corrected') THEN
        RAISE EXCEPTION 'Invalid review_status %: confirmation only allows confirmed or corrected', p_review_status;
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

    -- 3. Ownership Defense-in-Depth
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

    -- 5. Idempotency Check 1: slip already has linked_transaction_id (canonical link)
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

    -- 6. Idempotency Check 2: fallback for source_slip_id considers ONLY ACTIVE transactions
    -- Never relinks to an arbitrary historical VOIDED transaction
    SELECT * INTO v_existing_tx
    FROM public.transactions
    WHERE source_slip_id = p_slip_id
      AND user_id = p_user_id
      AND voided_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

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

-- 3. Privilege Hardening: Revoke from PUBLIC and anon, grant only to authenticated and service_role
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

COMMIT;

-- ============================================================================
-- 4. OPERATOR VERIFICATION SQL
-- ============================================================================
/*
WITH operator_checks AS (
    -- 1. old index exists with new active-only predicate
    SELECT
        '1. old index exists with new active-only predicate' AS check_name,
        EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'transactions'
              AND indexname = 'idx_transactions_source_slip_id_unique'
        ) AS passed,
        'Index idx_transactions_source_slip_id_unique exists on transactions' AS details
    UNION ALL
    -- 2. index is UNIQUE
    SELECT
        '2. index is UNIQUE',
        EXISTS (
            SELECT 1 FROM pg_index i
            JOIN pg_class c ON i.indexrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public'
              AND c.relname = 'idx_transactions_source_slip_id_unique'
              AND i.indisunique = true
        ),
        'Index idx_transactions_source_slip_id_unique enforces uniqueness'
    UNION ALL
    -- 3. predicate includes source_slip_id IS NOT NULL
    SELECT
        '3. predicate includes source_slip_id IS NOT NULL',
        EXISTS (
            SELECT 1 FROM pg_index i
            JOIN pg_class c ON i.indexrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public'
              AND c.relname = 'idx_transactions_source_slip_id_unique'
              AND pg_get_expr(i.indpred, i.indrelid) LIKE '%source_slip_id IS NOT NULL%'
        ),
        'Predicate requires source_slip_id IS NOT NULL'
    UNION ALL
    -- 4. predicate includes voided_at IS NULL
    SELECT
        '4. predicate includes voided_at IS NULL',
        EXISTS (
            SELECT 1 FROM pg_index i
            JOIN pg_class c ON i.indexrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public'
              AND c.relname = 'idx_transactions_source_slip_id_unique'
              AND pg_get_expr(i.indpred, i.indrelid) LIKE '%voided_at IS NULL%'
        ),
        'Predicate restricts uniqueness to ACTIVE transactions only (voided_at IS NULL)'
    UNION ALL
    -- 5. no lifetime-unique source_slip index remains
    SELECT
        '5. no lifetime-unique source_slip index remains',
        NOT EXISTS (
            SELECT 1 FROM pg_index i
            JOIN pg_class c ON i.indexrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            JOIN pg_class t ON i.indrelid = t.oid
            WHERE n.nspname = 'public'
              AND t.relname = 'transactions'
              AND i.indisunique = true
              AND pg_get_indexdef(c.oid) LIKE '%(source_slip_id)%'
              AND (i.indpred IS NULL OR pg_get_expr(i.indpred, i.indrelid) NOT LIKE '%voided_at IS NULL%')
        ),
        'No unique index on transactions(source_slip_id) remains without voided_at IS NULL condition'
    UNION ALL
    -- 6. replacement RPC still exists
    SELECT
        '6. replacement RPC still exists',
        EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
              AND p.proname = 'replace_voided_slip_transaction'
              AND p.prosecdef = true
        ),
        'replace_voided_slip_transaction RPC exists with SECURITY DEFINER'
    UNION ALL
    -- 7. restore replacement guard still exists
    SELECT
        '7. restore replacement guard still exists',
        EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
              AND p.proname = 'restore_transaction'
              AND pg_get_functiondef(p.oid) LIKE '%transaction_replacement_events%'
        ),
        'restore_transaction checks transaction_replacement_events before restoring'
)
SELECT check_name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status, details
FROM operator_checks;

-- Production Invariant Assertion Query:
-- Verify that across all transactions with a source_slip_id, at most ONE active transaction exists per slip.
SELECT
    source_slip_id,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE voided_at IS NULL) AS active_count
FROM public.transactions
WHERE source_slip_id IS NOT NULL
GROUP BY source_slip_id
HAVING COUNT(*) FILTER (WHERE voided_at IS NULL) > 1;
-- PASS CRITERIA: Returns 0 rows (active_count <= 1 for every source_slip_id).
*/
