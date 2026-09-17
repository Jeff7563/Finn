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

-- 1b. HARDEN public.slips, public.slip_ingestion_jobs, public.slip_corrections RLS
-- Drop legacy FOR ALL policy that allowed direct browser DELETE / INSERT
DROP POLICY IF EXISTS "Users can manage own slips" ON public.slips;

-- Authenticated owners may view own slips
CREATE POLICY "Users can view own slips"
    ON public.slips FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Authenticated owners may update own non-sensitive slip fields
CREATE POLICY "Users can update own slips"
    ON public.slips FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Explicitly revoke direct DELETE and INSERT privileges on public.slips from client roles.
-- Trusted server ingestion flows execute with service_role.
REVOKE DELETE, INSERT ON public.slips FROM authenticated, anon, PUBLIC;

-- Defense-in-depth trigger: reject any direct hard-delete of slip records
CREATE OR REPLACE FUNCTION public.guard_slip_delete_prevention()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Direct deletion of slip records is prohibited. Slip metadata and evidence must be preserved for audit retention.'
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_slip_hard_delete ON public.slips;
CREATE TRIGGER trg_prevent_slip_hard_delete
    BEFORE DELETE ON public.slips
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_slip_delete_prevention();

-- Harden slip audit and history tables against destructive deletion
DROP POLICY IF EXISTS "Users can manage own slip corrections" ON public.slip_corrections;

CREATE POLICY "Users can view own slip corrections"
    ON public.slip_corrections FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own slip corrections"
    ON public.slip_corrections FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

REVOKE DELETE ON public.slip_ingestion_jobs FROM authenticated, anon, PUBLIC;
REVOKE DELETE ON public.slip_corrections FROM authenticated, anon, PUBLIC;

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

-- Ownership integrity guard trigger for storage_binary_events
CREATE OR REPLACE FUNCTION public.guard_storage_binary_event_ownership()
RETURNS TRIGGER AS $$
DECLARE
    v_owner UUID;
BEGIN
    IF NEW.slip_id IS NOT NULL THEN
        SELECT user_id INTO v_owner
        FROM public.slips
        WHERE id = NEW.slip_id;

        IF v_owner IS NULL THEN
            RAISE EXCEPTION 'Target slip % does not exist', NEW.slip_id
                USING ERRCODE = 'P0002';
        END IF;

        IF v_owner <> NEW.user_id THEN
            RAISE EXCEPTION 'Storage binary audit event user_id % does not match slip owner %', NEW.user_id, v_owner
                USING ERRCODE = '42501';
        END IF;
    ELSIF NEW.source_document_id IS NOT NULL THEN
        SELECT user_id INTO v_owner
        FROM public.source_documents
        WHERE id = NEW.source_document_id;

        IF v_owner IS NULL THEN
            RAISE EXCEPTION 'Target source document % does not exist', NEW.source_document_id
                USING ERRCODE = 'P0002';
        END IF;

        IF v_owner <> NEW.user_id THEN
            RAISE EXCEPTION 'Storage binary audit event user_id % does not match source document owner %', NEW.user_id, v_owner
                USING ERRCODE = '42501';
        END IF;
    ELSE
        RAISE EXCEPTION 'Storage binary event must specify either slip_id or source_document_id'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_storage_binary_event_ownership ON public.storage_binary_events;
CREATE TRIGGER trg_guard_storage_binary_event_ownership
    BEFORE INSERT ON public.storage_binary_events
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_storage_binary_event_ownership();

-- ============================================================================
-- 4. STORAGE METADATA MUTATION GUARDS (TRIGGERS)
-- ============================================================================

-- A. Guard public.slips storage-sensitive fields and is_pinned on INSERT and UPDATE
CREATE OR REPLACE FUNCTION public.guard_slip_storage_metadata_mutation()
RETURNS TRIGGER AS $$
DECLARE
    is_trusted BOOLEAN;
BEGIN
    is_trusted := (COALESCE(current_setting('app.allow_storage_metadata_mutation', true), 'false') = 'true')
                  OR (COALESCE(auth.role(), '') = 'service_role');

    IF TG_OP = 'INSERT' THEN
        -- On INSERT, untrusted clients cannot set sensitive storage metadata or is_pinned
        IF NOT is_trusted THEN
            IF NEW.storage_path IS NOT NULL
               OR NEW.file_hash_sha256 IS NOT NULL
               OR NEW.file_size IS NOT NULL
               OR NEW.stored_file_size IS NOT NULL
               OR NEW.binary_deleted_at IS NOT NULL
               OR (NEW.is_pinned IS NOT NULL AND NEW.is_pinned IS DISTINCT FROM false) THEN
                RAISE EXCEPTION 'Direct client initialization of slip storage metadata or pin state (storage_path, file_hash_sha256, file_size, stored_file_size, binary_deleted_at, is_pinned) is prohibited. Mutations must execute via trusted server flow.';
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- On UPDATE, untrusted clients cannot modify sensitive storage metadata or is_pinned
        IF (OLD.storage_path IS DISTINCT FROM NEW.storage_path)
           OR (OLD.file_hash_sha256 IS DISTINCT FROM NEW.file_hash_sha256)
           OR (OLD.file_size IS DISTINCT FROM NEW.file_size)
           OR (OLD.stored_file_size IS DISTINCT FROM NEW.stored_file_size)
           OR (OLD.binary_deleted_at IS DISTINCT FROM NEW.binary_deleted_at)
           OR (OLD.is_pinned IS DISTINCT FROM NEW.is_pinned) THEN
            IF NOT is_trusted THEN
                RAISE EXCEPTION 'Direct client modification of slip storage metadata or pin state (storage_path, file_hash_sha256, file_size, stored_file_size, binary_deleted_at, is_pinned) is prohibited. Mutations must execute via trusted server flow.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_guard_slip_storage_metadata_mutation ON public.slips;
CREATE TRIGGER trg_guard_slip_storage_metadata_mutation
    BEFORE INSERT OR UPDATE ON public.slips
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_slip_storage_metadata_mutation();

-- B. Guard public.source_documents storage-sensitive fields and is_pinned on INSERT and UPDATE
CREATE OR REPLACE FUNCTION public.guard_source_document_storage_metadata_mutation()
RETURNS TRIGGER AS $$
DECLARE
    is_trusted BOOLEAN;
BEGIN
    is_trusted := (COALESCE(current_setting('app.allow_storage_metadata_mutation', true), 'false') = 'true')
                  OR (COALESCE(auth.role(), '') = 'service_role');

    IF TG_OP = 'INSERT' THEN
        -- On INSERT, untrusted clients cannot set sensitive storage metadata or is_pinned
        IF NOT is_trusted THEN
            IF NEW.storage_path IS NOT NULL
               OR NEW.file_hash IS NOT NULL
               OR NEW.file_size IS NOT NULL
               OR NEW.stored_file_size IS NOT NULL
               OR NEW.binary_deleted_at IS NOT NULL
               OR (NEW.is_pinned IS NOT NULL AND NEW.is_pinned IS DISTINCT FROM false) THEN
                RAISE EXCEPTION 'Direct client initialization of source document storage metadata or pin state (storage_path, file_hash, file_size, stored_file_size, binary_deleted_at, is_pinned) is prohibited. Mutations must execute via trusted server flow.';
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- On UPDATE, untrusted clients cannot modify sensitive storage metadata or is_pinned
        IF (OLD.storage_path IS DISTINCT FROM NEW.storage_path)
           OR (OLD.file_hash IS DISTINCT FROM NEW.file_hash)
           OR (OLD.file_size IS DISTINCT FROM NEW.file_size)
           OR (OLD.stored_file_size IS DISTINCT FROM NEW.stored_file_size)
           OR (OLD.binary_deleted_at IS DISTINCT FROM NEW.binary_deleted_at)
           OR (OLD.is_pinned IS DISTINCT FROM NEW.is_pinned) THEN
            IF NOT is_trusted THEN
                RAISE EXCEPTION 'Direct client modification of source document storage metadata or pin state (storage_path, file_hash, file_size, stored_file_size, binary_deleted_at, is_pinned) is prohibited. Mutations must execute via trusted server flow.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_guard_source_document_storage_metadata_mutation ON public.source_documents;
CREATE TRIGGER trg_guard_source_document_storage_metadata_mutation
    BEFORE INSERT OR UPDATE ON public.source_documents
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
-- The following queries allow operators to verify all database-level
-- storage privacy security invariants with explicit boolean PASS/FAIL confirmations.

-- Query 1: Verify authenticated slip DELETE is denied (revoked and no DELETE policy)
SELECT 
    CASE WHEN (
        NOT EXISTS (
            SELECT 1 FROM information_schema.role_table_grants 
            WHERE table_schema = 'public' AND table_name = 'slips' 
              AND grantee = 'authenticated' AND privilege_type = 'DELETE'
        ) AND NOT EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'public' AND tablename = 'slips' 
              AND cmd = 'DELETE' AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
        )
    ) THEN 'PASS' ELSE 'FAIL' END AS status,
    'authenticated direct DELETE on public.slips is completely denied' AS check_name;

-- Query 2: Verify anon slip DELETE is denied (revoked and no DELETE policy)
SELECT 
    CASE WHEN (
        NOT EXISTS (
            SELECT 1 FROM information_schema.role_table_grants 
            WHERE table_schema = 'public' AND table_name = 'slips' 
              AND grantee = 'anon' AND privilege_type = 'DELETE'
        ) AND NOT EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'public' AND tablename = 'slips' 
              AND cmd = 'DELETE' AND ('anon' = ANY(roles) OR 'public' = ANY(roles))
        )
    ) THEN 'PASS' ELSE 'FAIL' END AS status,
    'anon direct DELETE on public.slips is completely denied' AS check_name;

-- Query 3: Verify slip audit/history tables cannot be destructively deleted by browser roles
SELECT 
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    'slip audit/history tables (slip_ingestion_jobs, slip_corrections, storage_binary_events) cannot be deleted by browser roles' AS check_name
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('slip_ingestion_jobs', 'slip_corrections', 'storage_binary_events')
  AND grantee IN ('authenticated', 'anon', 'PUBLIC')
  AND privilege_type = 'DELETE';

-- Query 4: Verify storage_binary_events ownership guard trigger exists
SELECT 
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
    'storage_binary_events ownership integrity guard trigger trg_guard_storage_binary_event_ownership exists on INSERT' AS check_name
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'storage_binary_events'
  AND trigger_name = 'trg_guard_storage_binary_event_ownership'
  AND event_manipulation = 'INSERT'
  AND action_timing = 'BEFORE';

-- Query 5: Verify storage_binary_events direct mutation denied (INSERT, UPDATE, DELETE revoked)
SELECT 
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    'storage_binary_events direct INSERT, UPDATE, DELETE revoked from authenticated, anon, PUBLIC' AS check_name
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'storage_binary_events'
  AND grantee IN ('authenticated', 'anon', 'PUBLIC')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');

-- Query 6: Verify slips bucket exists and public = false
SELECT 
    CASE WHEN COUNT(*) > 0 AND bool_and(public = false) THEN 'PASS' ELSE 'FAIL' END AS status,
    'slips bucket exists and is private (public = false)' AS check_name
FROM storage.buckets
WHERE id = 'slips';

-- Query 7: Verify authenticated and anon storage.objects direct CRUD policies absent
SELECT 
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    'authenticated and anon direct CRUD policies absent on storage.objects for slips' AS check_name
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (policyname ILIKE '%slip%' OR qual ILIKE '%slips%' OR with_check ILIKE '%slips%')
  AND ('authenticated' = ANY(roles) OR 'anon' = ANY(roles) OR 'public' = ANY(roles));

-- Query 8: Verify metadata guards INSERT + UPDATE still present
SELECT 
    CASE WHEN (
        (SELECT COUNT(DISTINCT event_manipulation) FROM information_schema.triggers WHERE event_object_schema = 'public' AND event_object_table = 'slips' AND trigger_name = 'trg_guard_slip_storage_metadata_mutation' AND event_manipulation IN ('INSERT', 'UPDATE') AND action_timing = 'BEFORE') = 2
        AND
        (SELECT COUNT(DISTINCT event_manipulation) FROM information_schema.triggers WHERE event_object_schema = 'public' AND event_object_table = 'source_documents' AND trigger_name = 'trg_guard_source_document_storage_metadata_mutation' AND event_manipulation IN ('INSERT', 'UPDATE') AND action_timing = 'BEFORE') = 2
    ) THEN 'PASS' ELSE 'FAIL' END AS status,
    'metadata guards on slips and source_documents fire on both INSERT and UPDATE' AS check_name;

-- Consolidated Operator Verification Query:
WITH audit_checks AS (
    SELECT '1. Authenticated Slip DELETE Denied' AS item,
           (NOT EXISTS (
               SELECT 1 FROM information_schema.role_table_grants 
               WHERE table_schema = 'public' AND table_name = 'slips' 
                 AND grantee = 'authenticated' AND privilege_type = 'DELETE'
           ) AND NOT EXISTS (
               SELECT 1 FROM pg_policies 
               WHERE schemaname = 'public' AND tablename = 'slips' 
                 AND cmd = 'DELETE' AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
           )) AS passed,
           'DELETE on public.slips is revoked and no DELETE RLS policy exists for authenticated role' AS details
    UNION ALL
    SELECT '2. Anon Slip DELETE Denied',
           (NOT EXISTS (
               SELECT 1 FROM information_schema.role_table_grants 
               WHERE table_schema = 'public' AND table_name = 'slips' 
                 AND grantee = 'anon' AND privilege_type = 'DELETE'
           ) AND NOT EXISTS (
               SELECT 1 FROM pg_policies 
               WHERE schemaname = 'public' AND tablename = 'slips' 
                 AND cmd = 'DELETE' AND ('anon' = ANY(roles) OR 'public' = ANY(roles))
           )),
           'DELETE on public.slips is revoked and no DELETE RLS policy exists for anon role'
    UNION ALL
    SELECT '3. Slip Audit & History Tables Protected From Deletion',
           NOT EXISTS (
               SELECT 1 FROM information_schema.role_table_grants 
               WHERE table_schema = 'public' 
                 AND table_name IN ('slip_ingestion_jobs', 'slip_corrections', 'storage_binary_events') 
                 AND grantee IN ('authenticated', 'anon', 'PUBLIC') 
                 AND privilege_type = 'DELETE'
           ),
           'Direct DELETE revoked on slip_ingestion_jobs, slip_corrections, and storage_binary_events'
    UNION ALL
    SELECT '4. Storage Binary Events Ownership Guard Trigger',
           EXISTS (
               SELECT 1 FROM information_schema.triggers 
               WHERE event_object_schema = 'public' 
                 AND event_object_table = 'storage_binary_events' 
                 AND trigger_name = 'trg_guard_storage_binary_event_ownership' 
                 AND event_manipulation = 'INSERT' 
                 AND action_timing = 'BEFORE'
           ),
           'BEFORE INSERT trigger enforces user_id on audit event matches owner of slip or source document'
    UNION ALL
    SELECT '5. Direct Audit Trail Mutation Revoked',
           NOT EXISTS (
               SELECT 1 FROM information_schema.role_table_grants 
               WHERE table_schema = 'public' AND table_name = 'storage_binary_events' 
                 AND grantee IN ('authenticated', 'anon', 'PUBLIC') 
                 AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
           ),
           'Direct INSERT, UPDATE, DELETE on storage_binary_events are completely revoked from client roles'
    UNION ALL
    SELECT '6. Slips Bucket Private',
           EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'slips' AND public = false),
           'Supabase storage slips bucket is private (public = false)'
    UNION ALL
    SELECT '7. Direct Storage Objects Browser Policies Absent',
           NOT EXISTS (
               SELECT 1 FROM pg_policies 
               WHERE schemaname = 'storage' AND tablename = 'objects' 
                 AND (policyname ILIKE '%slip%' OR qual ILIKE '%slips%' OR with_check ILIKE '%slips%') 
                 AND ('authenticated' = ANY(roles) OR 'anon' = ANY(roles) OR 'public' = ANY(roles))
           ),
           'No direct authenticated or anonymous CRUD policies exist on storage.objects for slips'
    UNION ALL
    SELECT '8. Storage Metadata Guards on INSERT and UPDATE',
           ((SELECT COUNT(DISTINCT event_manipulation) FROM information_schema.triggers WHERE event_object_schema = 'public' AND event_object_table = 'slips' AND trigger_name = 'trg_guard_slip_storage_metadata_mutation' AND event_manipulation IN ('INSERT', 'UPDATE') AND action_timing = 'BEFORE') = 2
            AND
            (SELECT COUNT(DISTINCT event_manipulation) FROM information_schema.triggers WHERE event_object_schema = 'public' AND event_object_table = 'source_documents' AND trigger_name = 'trg_guard_source_document_storage_metadata_mutation' AND event_manipulation IN ('INSERT', 'UPDATE') AND action_timing = 'BEFORE') = 2),
           'Metadata mutation guards fire on both INSERT and UPDATE for slips and source_documents'
    UNION ALL
    SELECT '9. Audit Foreign Keys ON DELETE RESTRICT',
           (SELECT COUNT(*) FROM pg_constraint con JOIN pg_class c ON con.conrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = 'public' AND c.relname = 'storage_binary_events' AND con.contype = 'f' AND con.confdeltype = 'r') = 2,
           'Foreign keys on slip_id and source_document_id enforce ON DELETE RESTRICT to prevent audit cascade deletion'
)
SELECT item, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status, details FROM audit_checks;
*/
