-- Migration: 20260916000001_account_match_aliases.sql
-- Description: Account Match Pattern Intelligence & Safe Auto-Confirm
-- 1. Creates public.account_match_aliases table for learned masked pattern mappings.
-- 2. Enables RLS with strict per-user ownership and cross-entity validation.
-- 3. Idempotent backfill from existing confirmed slips and transactions.
-- 4. Updates confirm_slip_transaction RPC to allow 'processing' status for atomic auto-confirm.

-- ============================================================================
-- 1. Create account_match_aliases table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.account_match_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    institution TEXT,
    raw_masked_pattern TEXT,
    normalized_masked_pattern TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual_confirm',
    confirmed_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_account_match_aliases UNIQUE (user_id, account_id, institution, normalized_masked_pattern)
);

COMMENT ON TABLE public.account_match_aliases IS 'Learned positional masked account pattern mappings per user';
COMMENT ON COLUMN public.account_match_aliases.normalized_masked_pattern IS 'Positional mask with x/X/•/·/* canonicalized to * and separators stripped';
COMMENT ON COLUMN public.account_match_aliases.source IS 'Learning origin: manual_confirm, manual_edit, backfill, or user_configured';

-- ============================================================================
-- 2. Performance Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_account_match_aliases_lookup
    ON public.account_match_aliases (user_id, institution, normalized_masked_pattern);

CREATE INDEX IF NOT EXISTS idx_account_match_aliases_account
    ON public.account_match_aliases (account_id);

-- ============================================================================
-- 3. Row-Level Security (RLS)
-- ============================================================================
ALTER TABLE public.account_match_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own account match aliases" ON public.account_match_aliases;
CREATE POLICY "Users can view own account match aliases"
    ON public.account_match_aliases
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own account match aliases" ON public.account_match_aliases;
CREATE POLICY "Users can insert own account match aliases"
    ON public.account_match_aliases
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own account match aliases" ON public.account_match_aliases;
CREATE POLICY "Users can update own account match aliases"
    ON public.account_match_aliases
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own account match aliases" ON public.account_match_aliases;
CREATE POLICY "Users can delete own account match aliases"
    ON public.account_match_aliases
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- 4. Cross-Entity Ownership Trigger (Defense-in-Depth)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_alias_account_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.accounts
        WHERE id = NEW.account_id AND user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'Security violation: account % does not belong to user %', NEW.account_id, NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_alias_account_ownership ON public.account_match_aliases;
CREATE TRIGGER trg_check_alias_account_ownership
    BEFORE INSERT OR UPDATE ON public.account_match_aliases
    FOR EACH ROW
    EXECUTE FUNCTION public.check_alias_account_ownership();

-- ============================================================================
-- 5. Safe, Rerunnable Backfill from Verified Transactions
-- ============================================================================
DO $$
BEGIN
    -- Backfill expense & transfer sender patterns
    INSERT INTO public.account_match_aliases (
        user_id,
        account_id,
        institution,
        raw_masked_pattern,
        normalized_masked_pattern,
        source,
        confirmed_count,
        created_at,
        updated_at
    )
    SELECT
        t.user_id,
        t.from_account_id,
        LOWER(TRIM(COALESCE(s.extracted_json->'sender'->>'bank', ''))),
        s.extracted_json->'sender'->>'accountMasked',
        REGEXP_REPLACE(
            REGEXP_REPLACE(s.extracted_json->'sender'->>'accountMasked', '[- /.]', '', 'g'),
            '[xX•·_~#]', '*', 'g'
        ),
        'backfill',
        COUNT(*),
        NOW(),
        NOW()
    FROM public.transactions t
    JOIN public.slips s ON t.source_slip_id = s.id AND t.user_id = s.user_id
    WHERE t.from_account_id IS NOT NULL
      AND s.extracted_json->'sender'->>'accountMasked' IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(s.extracted_json->'sender'->>'accountMasked', '[- /.]', '', 'g')) >= 3
      AND t.review_status IN ('confirmed', 'corrected')
      AND s.status = 'created'
    GROUP BY
        t.user_id,
        t.from_account_id,
        LOWER(TRIM(COALESCE(s.extracted_json->'sender'->>'bank', ''))),
        s.extracted_json->'sender'->>'accountMasked',
        REGEXP_REPLACE(
            REGEXP_REPLACE(s.extracted_json->'sender'->>'accountMasked', '[- /.]', '', 'g'),
            '[xX•·_~#]', '*', 'g'
        )
    ON CONFLICT (user_id, account_id, institution, normalized_masked_pattern)
    DO UPDATE SET
        confirmed_count = account_match_aliases.confirmed_count + EXCLUDED.confirmed_count,
        updated_at = NOW();

    -- Backfill income & transfer receiver patterns
    INSERT INTO public.account_match_aliases (
        user_id,
        account_id,
        institution,
        raw_masked_pattern,
        normalized_masked_pattern,
        source,
        confirmed_count,
        created_at,
        updated_at
    )
    SELECT
        t.user_id,
        t.to_account_id,
        LOWER(TRIM(COALESCE(s.extracted_json->'receiver'->>'bank', ''))),
        s.extracted_json->'receiver'->>'accountMasked',
        REGEXP_REPLACE(
            REGEXP_REPLACE(s.extracted_json->'receiver'->>'accountMasked', '[- /.]', '', 'g'),
            '[xX•·_~#]', '*', 'g'
        ),
        'backfill',
        COUNT(*),
        NOW(),
        NOW()
    FROM public.transactions t
    JOIN public.slips s ON t.source_slip_id = s.id AND t.user_id = s.user_id
    WHERE t.to_account_id IS NOT NULL
      AND s.extracted_json->'receiver'->>'accountMasked' IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(s.extracted_json->'receiver'->>'accountMasked', '[- /.]', '', 'g')) >= 3
      AND t.review_status IN ('confirmed', 'corrected')
      AND s.status = 'created'
    GROUP BY
        t.user_id,
        t.to_account_id,
        LOWER(TRIM(COALESCE(s.extracted_json->'receiver'->>'bank', ''))),
        s.extracted_json->'receiver'->>'accountMasked',
        REGEXP_REPLACE(
            REGEXP_REPLACE(s.extracted_json->'receiver'->>'accountMasked', '[- /.]', '', 'g'),
            '[xX•·_~#]', '*', 'g'
        )
    ON CONFLICT (user_id, account_id, institution, normalized_masked_pattern)
    DO UPDATE SET
        confirmed_count = account_match_aliases.confirmed_count + EXCLUDED.confirmed_count,
        updated_at = NOW();
END $$;
