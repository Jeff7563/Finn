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
-- 5. Atomic Void RPC: void_transaction
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

    -- 5. Mark Transaction as Voided
    UPDATE public.transactions
    SET
        voided_at = now(),
        voided_by = p_user_id,
        void_reason = v_trimmed_reason,
        updated_at = now()
    WHERE id = p_transaction_id
    RETURNING * INTO v_tx;

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
-- 6. Atomic Restore RPC: restore_transaction
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

    -- 5. Restore Transaction (Clear void state)
    UPDATE public.transactions
    SET
        voided_at = NULL,
        voided_by = NULL,
        void_reason = NULL,
        updated_at = now()
    WHERE id = p_transaction_id
    RETURNING * INTO v_tx;

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
