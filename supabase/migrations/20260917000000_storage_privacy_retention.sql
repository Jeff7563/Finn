-- ============================================================================
-- FINN Migration: Storage Privacy Hardening & Slip Retention
-- Migration: 20260917000000_storage_privacy_retention.sql
--
-- Hardens Supabase Storage access to be private-by-default and server-mediated.
-- Eliminates direct browser CRUD policies on storage.objects for slips.
-- Implements retention metadata, user retention settings, immutable audit
-- trail (storage_binary_events), and storage metadata mutation guards.
--
-- IMPORTANT: THIS MIGRATION IS GENERATED FOR AUDIT. DO NOT APPLY TO PRODUCTION
-- WITHOUT EXPLICIT OPERATOR APPROVAL.
-- ============================================================================

-- ============================================================================
-- 1. LEGACY SLIP RETENTION METADATA (public.slips)
-- ============================================================================
ALTER TABLE public.slips
    ADD COLUMN IF NOT EXISTS stored_file_size BIGINT NULL,
    ADD COLUMN IF NOT EXISTS binary_deleted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;

-- Backfill stored_file_size from file_size for existing active slips
UPDATE public.slips
SET stored_file_size = file_size
WHERE stored_file_size IS NULL AND binary_deleted_at IS NULL;

-- Performance index for retention eligibility checks and queries
CREATE INDEX IF NOT EXISTS idx_slips_retention
    ON public.slips(user_id, status, is_pinned, binary_deleted_at);

-- ============================================================================
-- 2. STORAGE RETENTION SETTINGS (public.storage_retention_settings)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.storage_retention_settings (
    user_id                         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    slip_retention_days             INT NOT NULL DEFAULT 90 CHECK (slip_retention_days BETWEEN 7 AND 3650),
    failed_retention_days           INT NOT NULL DEFAULT 7 CHECK (failed_retention_days BETWEEN 1 AND 365),
    source_document_retention_days  INT NOT NULL DEFAULT 90 CHECK (source_document_retention_days BETWEEN 7 AND 3650),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.storage_retention_settings ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own retention settings
CREATE POLICY "Users can read own retention settings"
    ON public.storage_retention_settings FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Authenticated users can insert their own retention settings
CREATE POLICY "Users can insert own retention settings"
    ON public.storage_retention_settings FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Authenticated users can update their own retention settings
CREATE POLICY "Users can update own retention settings"
    ON public.storage_retention_settings FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Explicitly revoke DELETE to prevent accidental loss of policy settings
REVOKE DELETE ON public.storage_retention_settings FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON public.storage_retention_settings TO authenticated;

-- ============================================================================
-- 3. STORAGE BINARY AUDIT TRAIL (public.storage_binary_events)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.storage_binary_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    slip_id                 UUID NULL REFERENCES public.slips(id) ON DELETE RESTRICT,
    source_document_id      UUID NULL REFERENCES public.source_documents(id) ON DELETE RESTRICT,
    action                  TEXT NOT NULL CHECK (action IN ('prune_requested', 'prune_completed', 'prune_failed', 'pin', 'unpin')),
    storage_path_snapshot   TEXT,
    file_hash_snapshot      TEXT,
    bytes_affected          BIGINT,
    reason                  TEXT NULL,
    safe_error_message      TEXT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_storage_binary_events_target CHECK (
        (slip_id IS NOT NULL AND source_document_id IS NULL) OR
        (slip_id IS NULL AND source_document_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_storage_binary_events_user_id
    ON public.storage_binary_events(user_id);

CREATE INDEX IF NOT EXISTS idx_storage_binary_events_slip_id
    ON public.storage_binary_events(slip_id);

CREATE INDEX IF NOT EXISTS idx_storage_binary_events_source_doc_id
    ON public.storage_binary_events(source_document_id);

CREATE INDEX IF NOT EXISTS idx_storage_binary_events_created_at
    ON public.storage_binary_events(created_at);

ALTER TABLE public.storage_binary_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users may SELECT their own audit events for audit history display
CREATE POLICY "Users can view own storage binary events"
    ON public.storage_binary_events FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Explicitly revoke direct INSERT, UPDATE, DELETE from browser clients.
-- All binary events must strictly be recorded by trusted server-side service role.
REVOKE INSERT, UPDATE, DELETE ON public.storage_binary_events FROM authenticated, anon;
GRANT SELECT ON public.storage_binary_events TO authenticated;

-- ============================================================================
-- 4. STORAGE METADATA MUTATION GUARDS (TRIGGERS)
-- ============================================================================

-- A. Guard public.slips storage-sensitive fields
CREATE OR REPLACE FUNCTION public.guard_slip_storage_metadata_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (OLD.storage_path IS DISTINCT FROM NEW.storage_path)
           OR (OLD.file_hash_sha256 IS DISTINCT FROM NEW.file_hash_sha256)
           OR (OLD.file_size IS DISTINCT FROM NEW.file_size)
           OR (OLD.stored_file_size IS DISTINCT FROM NEW.stored_file_size)
           OR (OLD.binary_deleted_at IS DISTINCT FROM NEW.binary_deleted_at) THEN
            IF COALESCE(current_setting('app.allow_storage_metadata_mutation', true), 'false') <> 'true'
               AND COALESCE(auth.role(), '') <> 'service_role' THEN
                RAISE EXCEPTION 'Direct client modification of slip storage metadata (storage_path, file_hash_sha256, file_size, stored_file_size, binary_deleted_at) is prohibited. Mutations must execute via trusted server flow.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_guard_slip_storage_metadata_mutation ON public.slips;
CREATE TRIGGER trg_guard_slip_storage_metadata_mutation
    BEFORE UPDATE ON public.slips
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_slip_storage_metadata_mutation();

-- B. Guard public.source_documents storage-sensitive fields
CREATE OR REPLACE FUNCTION public.guard_source_document_storage_metadata_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (OLD.storage_path IS DISTINCT FROM NEW.storage_path)
           OR (OLD.file_hash IS DISTINCT FROM NEW.file_hash)
           OR (OLD.file_size IS DISTINCT FROM NEW.file_size)
           OR (OLD.stored_file_size IS DISTINCT FROM NEW.stored_file_size)
           OR (OLD.binary_deleted_at IS DISTINCT FROM NEW.binary_deleted_at) THEN
            IF COALESCE(current_setting('app.allow_storage_metadata_mutation', true), 'false') <> 'true'
               AND COALESCE(auth.role(), '') <> 'service_role' THEN
                RAISE EXCEPTION 'Direct client modification of source document storage metadata (storage_path, file_hash, file_size, stored_file_size, binary_deleted_at) is prohibited. Mutations must execute via trusted server flow.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_guard_source_document_storage_metadata_mutation ON public.source_documents;
CREATE TRIGGER trg_guard_source_document_storage_metadata_mutation
    BEFORE UPDATE ON public.source_documents
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_source_document_storage_metadata_mutation();

-- ============================================================================
-- 5. STORAGE OBJECTS RLS HARDENING (storage.objects)
-- ============================================================================
-- Remove direct authenticated CRUD policies from storage.objects for the slips bucket.
-- All object operations are mediated by Finn server-side trusted service role.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
        EXECUTE 'DROP POLICY IF EXISTS "Users can access own slips" ON storage.objects;';
        EXECUTE 'DROP POLICY IF EXISTS "Users can upload own slips" ON storage.objects;';
        EXECUTE 'DROP POLICY IF EXISTS "Users can update own slips" ON storage.objects;';
        EXECUTE 'DROP POLICY IF EXISTS "Users can delete own slips" ON storage.objects;';
        EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can access own slips" ON storage.objects;';
        EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can upload own slips" ON storage.objects;';
        EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can update own slips" ON storage.objects;';
        EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can delete own slips" ON storage.objects;';
    END IF;

    -- Ensure slips bucket exists and is private (public = false)
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
END $$;

-- ============================================================================
-- 6. OPERATOR VERIFICATION SQL (Section 23)
-- ============================================================================
/*
-- Run following verification queries against Supabase SQL Editor:

-- Q1: Verify slips new columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'slips'
  AND column_name IN ('stored_file_size', 'binary_deleted_at', 'is_pinned');
-- Expected: 3 rows returned

-- Q2: Verify storage_retention_settings table exists
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'storage_retention_settings';
-- Expected: 1 row returned

-- Q3: Verify storage_binary_events table exists
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'storage_binary_events';
-- Expected: 1 row returned

-- Q4: Verify RLS is enabled on all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('slips', 'storage_retention_settings', 'storage_binary_events');
-- Expected: all rowsecurity = true

-- Q5: Verify audit FKs have ON DELETE RESTRICT
SELECT
    tc.table_name, kcu.column_name, rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.table_schema = 'public' AND tc.table_name = 'storage_binary_events';
-- Expected: delete_rule = 'RESTRICT' for slip_id and source_document_id

-- Q6: Verify slips bucket exists and public = false
SELECT id, name, public FROM storage.buckets WHERE id = 'slips';
-- Expected: 1 row with public = false

-- Q7: Verify NO direct authenticated or anon policies exist on storage.objects for slips
SELECT policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (policyname ILIKE '%slip%' OR qual ILIKE '%slips%');
-- Expected: 0 rows returned

-- Q8: Verify storage metadata mutation guard triggers exist
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN ('trg_guard_slip_storage_metadata_mutation', 'trg_guard_source_document_storage_metadata_mutation');
-- Expected: 2 rows returned
*/
