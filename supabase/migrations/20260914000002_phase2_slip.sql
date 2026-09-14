-- Phase 2 Schema Migration: Slip Automation
-- Tables: ingest_tokens, slips, slip_ingestion_jobs, slip_corrections
-- Storage: private slips bucket and owner-only RLS policies

-- 1. INGEST TOKENS
CREATE TABLE IF NOT EXISTS public.ingest_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'iPhone 11 Pro Max',
    scope TEXT NOT NULL DEFAULT 'slip:ingest',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.ingest_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own ingest tokens"
ON public.ingest_tokens FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ingest_tokens_user ON public.ingest_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_ingest_tokens_hash ON public.ingest_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_ingest_tokens_active ON public.ingest_tokens(user_id, revoked_at, expires_at);

-- 2. SLIPS
CREATE TABLE IF NOT EXISTS public.slips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    file_hash_sha256 TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'web_upload' CHECK (source IN ('web_upload', 'ios_shortcut', 'manual')),
    parser_version TEXT NOT NULL DEFAULT 'v1',
    qr_payload TEXT,
    extracted_json JSONB,
    raw_ocr_text TEXT,
    overall_confidence NUMERIC(3, 2),
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
        'uploaded', 'processing', 'needs_review', 'created', 'duplicate', 'failed', 'rejected'
    )),
    linked_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    duplicate_of_slip_id UUID REFERENCES public.slips(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

ALTER TABLE public.slips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own slips"
ON public.slips FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_slips_user ON public.slips(user_id);
CREATE INDEX IF NOT EXISTS idx_slips_user_hash ON public.slips(user_id, file_hash_sha256);
CREATE INDEX IF NOT EXISTS idx_slips_user_status ON public.slips(user_id, status);
CREATE INDEX IF NOT EXISTS idx_slips_linked_tx ON public.slips(linked_transaction_id);

-- 3. SLIP INGESTION JOBS
CREATE TABLE IF NOT EXISTS public.slip_ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    slip_id UUID NOT NULL REFERENCES public.slips(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN (
        'processing', 'created', 'needs_review', 'duplicate', 'failed'
    )),
    attempt_count INTEGER NOT NULL DEFAULT 1,
    processor_version TEXT NOT NULL DEFAULT 'v1',
    error_code TEXT,
    safe_error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.slip_ingestion_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own slip jobs"
ON public.slip_ingestion_jobs FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_slip_jobs_user ON public.slip_ingestion_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_slip_jobs_slip ON public.slip_ingestion_jobs(slip_id);

-- 4. SLIP CORRECTIONS
CREATE TABLE IF NOT EXISTS public.slip_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    slip_id UUID NOT NULL REFERENCES public.slips(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    extracted_value JSONB,
    corrected_value JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.slip_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own slip corrections"
ON public.slip_corrections FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_slip_corrections_user ON public.slip_corrections(user_id);
CREATE INDEX IF NOT EXISTS idx_slip_corrections_slip ON public.slip_corrections(slip_id);

-- 5. RELATIONAL OWNERSHIP INTEGRITY TRIGGER
-- Ensure linked_transaction_id on slips belongs to the same user
CREATE OR REPLACE FUNCTION public.check_slip_transaction_ownership()
RETURNS TRIGGER AS $$
DECLARE
    tx_user_id UUID;
BEGIN
    IF NEW.linked_transaction_id IS NOT NULL THEN
        SELECT user_id INTO tx_user_id FROM public.transactions WHERE id = NEW.linked_transaction_id;
        IF tx_user_id IS NULL OR tx_user_id != NEW.user_id THEN
            RAISE EXCEPTION 'Security violation: linked transaction must belong to the slip owner';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_slip_tx_ownership ON public.slips;
CREATE TRIGGER trg_check_slip_tx_ownership
BEFORE INSERT OR UPDATE OF linked_transaction_id ON public.slips
FOR EACH ROW
EXECUTE FUNCTION public.check_slip_transaction_ownership();

-- 6. STORAGE BUCKET AND POLICIES FOR PRIVATE 'slips' BUCKET
DO $$
BEGIN
    -- Ensure bucket exists and is strictly private
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES (
            'slips',
            'slips',
            false,
            10485760, -- 10MB limit
            ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
        )
        ON CONFLICT (id) DO UPDATE SET
            public = false,
            file_size_limit = 10485760,
            allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    END IF;

    -- Ensure storage schema policies are defined if storage.objects exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN

        EXECUTE 'DROP POLICY IF EXISTS "Users can access own slips" ON storage.objects;';
        EXECUTE 'DROP POLICY IF EXISTS "Users can upload own slips" ON storage.objects;';
        EXECUTE 'DROP POLICY IF EXISTS "Users can update own slips" ON storage.objects;';
        EXECUTE 'DROP POLICY IF EXISTS "Users can delete own slips" ON storage.objects;';

        EXECUTE '
            CREATE POLICY "Users can access own slips"
            ON storage.objects FOR SELECT
            TO authenticated
            USING (
                bucket_id = ''slips'' AND
                (storage.foldername(name))[1] = auth.uid()::text
            );

            CREATE POLICY "Users can upload own slips"
            ON storage.objects FOR INSERT
            TO authenticated
            WITH CHECK (
                bucket_id = ''slips'' AND
                (storage.foldername(name))[1] = auth.uid()::text
            );

            CREATE POLICY "Users can update own slips"
            ON storage.objects FOR UPDATE
            TO authenticated
            USING (
                bucket_id = ''slips'' AND
                (storage.foldername(name))[1] = auth.uid()::text
            )
            WITH CHECK (
                bucket_id = ''slips'' AND
                (storage.foldername(name))[1] = auth.uid()::text
            );

            CREATE POLICY "Users can delete own slips"
            ON storage.objects FOR DELETE
            TO authenticated
            USING (
                bucket_id = ''slips'' AND
                (storage.foldername(name))[1] = auth.uid()::text
            );
        ';
    END IF;
END $$;
