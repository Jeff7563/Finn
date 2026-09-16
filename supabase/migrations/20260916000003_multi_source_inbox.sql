-- Migration: 20260916000003_multi_source_inbox.sql
-- Description: Multi-Source Inbox Architecture & Transaction Evidence Bridge
-- Status: CREATED ONLY (Do NOT apply automatically; pending operator audit)
--
-- Tables (EXACTLY 6 TABLES):
-- 1. source_connections: Browser-visible connection metadata (Option A: No credentials stored)
-- 2. source_documents: Raw uploaded/received documents (emails, CSVs, PDFs) with storage/retention tracking
-- 3. import_batches: Ingestion batch lifecycle, progress, and deduplication summary
-- 4. ingestion_items: Individual extracted transaction candidates
-- 5. transaction_evidence: Poly-source bridge between transactions and slips/ingestion items
-- 6. reconciliation_runs: Immutable point-in-time audit snapshots of account balances
--
-- Security:
-- - RLS enabled on all 6 tables (scoped to auth.uid() = user_id)
-- - Database-level triggers enforcing cross-user ownership across transactions and evidence
-- - Immutable append-only policy for reconciliation_runs (no UPDATE permitted)
-- - Token separation: Credentials MUST NOT be stored in source_connections

-- ============================================================================
-- 1. source_connections
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.source_connections (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider            TEXT NOT NULL CHECK (provider IN ('gmail', 'google_drive', 'bank_statement', 'api', 'manual')),
    label               TEXT NULL,
    status              TEXT NOT NULL CHECK (status IN ('active', 'paused', 'error', 'revoked')),
    provider_account_id TEXT NULL,
    last_synced_at      TIMESTAMPTZ NULL,
    config              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_source_connections_provider_account UNIQUE (user_id, provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_source_connections_user_id ON public.source_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_source_connections_status ON public.source_connections(user_id, status);

ALTER TABLE public.source_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "source_connections_select_own"
    ON public.source_connections FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "source_connections_insert_own"
    ON public.source_connections FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "source_connections_update_own"
    ON public.source_connections FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "source_connections_delete_own"
    ON public.source_connections FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- 2. source_documents
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.source_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    connection_id       UUID NULL REFERENCES public.source_connections(id) ON DELETE SET NULL,
    document_type       TEXT NOT NULL CHECK (document_type IN ('email', 'csv_statement', 'pdf_statement', 'api_response')),
    storage_path        TEXT NULL,
    original_filename   TEXT NULL,
    file_hash           TEXT NULL, -- SHA-256 (survives optimization)
    file_size           BIGINT NULL, -- original file size in bytes
    stored_file_size    BIGINT NULL, -- stored/compressed file size in bytes
    is_pinned           BOOLEAN NOT NULL DEFAULT false, -- pinned documents never cleanup candidates
    binary_deleted_at   TIMESTAMPTZ NULL, -- set when binary is pruned, preserving metadata
    status              TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'processed', 'failed')),
    provider_metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_documents_user_id ON public.source_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_source_documents_connection_id ON public.source_documents(connection_id);
CREATE INDEX IF NOT EXISTS idx_source_documents_file_hash ON public.source_documents(user_id, file_hash);
CREATE INDEX IF NOT EXISTS idx_source_documents_status ON public.source_documents(user_id, status);
CREATE INDEX IF NOT EXISTS idx_source_documents_pinned ON public.source_documents(user_id, is_pinned);

ALTER TABLE public.source_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "source_documents_select_own"
    ON public.source_documents FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "source_documents_insert_own"
    ON public.source_documents FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "source_documents_update_own"
    ON public.source_documents FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "source_documents_delete_own"
    ON public.source_documents FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- 3. import_batches
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.import_batches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    connection_id       UUID NULL REFERENCES public.source_connections(id) ON DELETE SET NULL,
    source_document_id  UUID NULL REFERENCES public.source_documents(id) ON DELETE SET NULL,
    batch_type          TEXT NOT NULL CHECK (batch_type IN ('csv_statement', 'gmail_sync', 'drive_sync', 'manual_import')),
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    total_items         INT NOT NULL DEFAULT 0,
    success_count       INT NOT NULL DEFAULT 0,
    error_count         INT NOT NULL DEFAULT 0,
    duplicate_count     INT NOT NULL DEFAULT 0,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_batches_user_id ON public.import_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON public.import_batches(user_id, status);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_batches_select_own"
    ON public.import_batches FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "import_batches_insert_own"
    ON public.import_batches FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "import_batches_update_own"
    ON public.import_batches FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "import_batches_delete_own"
    ON public.import_batches FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- 4. ingestion_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ingestion_items (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_document_id      UUID NOT NULL REFERENCES public.source_documents(id) ON DELETE CASCADE,
    connection_id           UUID NULL REFERENCES public.source_connections(id) ON DELETE SET NULL,
    batch_id                UUID NULL REFERENCES public.import_batches(id) ON DELETE SET NULL,
    item_type               TEXT NOT NULL CHECK (item_type IN ('email_notification', 'statement_row', 'api_transaction')),
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'linked', 'dismissed', 'error')),
    raw_data                JSONB NULL,
    parsed_data             JSONB NULL,
    fingerprint             TEXT NULL,
    provider_external_id    TEXT NULL,
    reference_number        TEXT NULL,
    match_class             TEXT NULL CHECK (match_class IN ('exact_duplicate', 'strong_match', 'possible_match', 'no_match')),
    matched_transaction_id  UUID NULL REFERENCES public.transactions(id) ON DELETE SET NULL,
    confidence_score        NUMERIC(3,2) NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scoped uniqueness: user + connection + provider_external_id for strong deduplication
CREATE UNIQUE INDEX IF NOT EXISTS uq_ingestion_items_provider_ext_id
    ON public.ingestion_items(user_id, connection_id, provider_external_id)
    WHERE connection_id IS NOT NULL AND provider_external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_items_user_id ON public.ingestion_items(user_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_items_source_doc ON public.ingestion_items(source_document_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_items_batch_id ON public.ingestion_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_items_fingerprint ON public.ingestion_items(user_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_ingestion_items_status ON public.ingestion_items(user_id, status);

ALTER TABLE public.ingestion_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ingestion_items_select_own"
    ON public.ingestion_items FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "ingestion_items_insert_own"
    ON public.ingestion_items FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ingestion_items_update_own"
    ON public.ingestion_items FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ingestion_items_delete_own"
    ON public.ingestion_items FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- 5. transaction_evidence
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.transaction_evidence (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    transaction_id      UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    slip_id             UUID NULL REFERENCES public.slips(id) ON DELETE CASCADE,
    ingestion_item_id   UUID NULL REFERENCES public.ingestion_items(id) ON DELETE CASCADE,
    evidence_type       TEXT NOT NULL CHECK (evidence_type IN ('slip', 'email_notification', 'statement_row', 'api_import')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Decision 1 Constraint: Exactly ONE of slip_id or ingestion_item_id must be non-null
    CONSTRAINT chk_transaction_evidence_exactly_one_source
        CHECK (((slip_id IS NOT NULL)::int + (ingestion_item_id IS NOT NULL)::int) = 1)
);

-- Slip evidence can link to at most one transaction
CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_evidence_slip_id
    ON public.transaction_evidence(slip_id)
    WHERE slip_id IS NOT NULL;

-- Ingestion item evidence can link to at most one transaction
CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_evidence_ingestion_item_id
    ON public.transaction_evidence(ingestion_item_id)
    WHERE ingestion_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transaction_evidence_user_id ON public.transaction_evidence(user_id);
CREATE INDEX IF NOT EXISTS idx_transaction_evidence_tx_id ON public.transaction_evidence(transaction_id);

ALTER TABLE public.transaction_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transaction_evidence_select_own"
    ON public.transaction_evidence FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "transaction_evidence_insert_own"
    ON public.transaction_evidence FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "transaction_evidence_delete_own"
    ON public.transaction_evidence FOR DELETE
    USING (auth.uid() = user_id);

-- Cross-User Ownership Validation Trigger (Decision 1)
-- Enforces that transaction_id, slip_id, and ingestion_item_id belong to the SAME user_id
CREATE OR REPLACE FUNCTION public.validate_transaction_evidence_ownership()
RETURNS TRIGGER AS $$
DECLARE
    v_tx_user_id UUID;
    v_slip_user_id UUID;
    v_item_user_id UUID;
BEGIN
    -- Validate transaction user_id
    SELECT user_id INTO v_tx_user_id FROM public.transactions WHERE id = NEW.transaction_id;
    IF v_tx_user_id IS NULL OR v_tx_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Cross-user integrity violation: transaction % does not belong to user %',
            NEW.transaction_id, NEW.user_id;
    END IF;

    -- Validate slip user_id if present
    IF NEW.slip_id IS NOT NULL THEN
        SELECT user_id INTO v_slip_user_id FROM public.slips WHERE id = NEW.slip_id;
        IF v_slip_user_id IS NULL OR v_slip_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cross-user integrity violation: slip % does not belong to user %',
                NEW.slip_id, NEW.user_id;
        END IF;
    END IF;

    -- Validate ingestion_item user_id if present
    IF NEW.ingestion_item_id IS NOT NULL THEN
        SELECT user_id INTO v_item_user_id FROM public.ingestion_items WHERE id = NEW.ingestion_item_id;
        IF v_item_user_id IS NULL OR v_item_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cross-user integrity violation: ingestion item % does not belong to user %',
                NEW.ingestion_item_id, NEW.user_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_validate_transaction_evidence_ownership ON public.transaction_evidence;
CREATE TRIGGER trg_validate_transaction_evidence_ownership
    BEFORE INSERT OR UPDATE ON public.transaction_evidence
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_transaction_evidence_ownership();

-- ============================================================================
-- 6. reconciliation_runs (Audit Snapshots - Decision 4)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    account_id              UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    target_instant          TIMESTAMPTZ NOT NULL,
    authoritative_balance   BIGINT NOT NULL, -- Satang integer
    calculated_balance      BIGINT NULL,     -- Satang integer (NULL if cannot calculate safely)
    difference              BIGINT NULL,     -- Satang integer: authoritative - calculated
    status                  TEXT NOT NULL CHECK (status IN ('balanced', 'difference_found', 'cannot_calculate_safely')),
    source_document_id      UUID NULL REFERENCES public.source_documents(id) ON DELETE SET NULL,
    calculation_version     INT NOT NULL DEFAULT 1,
    note                    TEXT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_account_target
    ON public.reconciliation_runs(account_id, target_instant DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_user_account
    ON public.reconciliation_runs(user_id, account_id);

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;

-- Immutable audit snapshots: SELECT and INSERT only. NO UPDATE allowed!
CREATE POLICY "reconciliation_runs_select_own"
    ON public.reconciliation_runs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "reconciliation_runs_insert_own"
    ON public.reconciliation_runs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Explicitly disallow updates on reconciliation runs to protect audit integrity
REVOKE UPDATE ON public.reconciliation_runs FROM authenticated, anon;

-- ============================================================================
-- Helper updated_at Triggers
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_source_connections_updated_at ON public.source_connections;
CREATE TRIGGER trg_source_connections_updated_at
    BEFORE UPDATE ON public.source_connections
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_source_documents_updated_at ON public.source_documents;
CREATE TRIGGER trg_source_documents_updated_at
    BEFORE UPDATE ON public.source_documents
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_import_batches_updated_at ON public.import_batches;
CREATE TRIGGER trg_import_batches_updated_at
    BEFORE UPDATE ON public.import_batches
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_ingestion_items_updated_at ON public.ingestion_items;
CREATE TRIGGER trg_ingestion_items_updated_at
    BEFORE UPDATE ON public.ingestion_items
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- FUTURE REFERENCE (Phase 4+ Option B Credential Table Specification)
-- ============================================================================
-- DO NOT UNCOMMENT OR RUN UNTIL REAL OAUTH WORK BEGINS.
--
-- CREATE TABLE IF NOT EXISTS public.source_connection_credentials (
--     id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     connection_id           UUID NOT NULL REFERENCES public.source_connections(id) ON DELETE CASCADE,
--     encrypted_refresh_token BYTEA NOT NULL,
--     encrypted_access_token  BYTEA NULL,
--     nonce                   BYTEA NOT NULL,
--     auth_tag                BYTEA NOT NULL,
--     key_version             INT NOT NULL DEFAULT 1,
--     expires_at              TIMESTAMPTZ NULL,
--     created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
--     updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
-- );
-- REVOKE ALL ON public.source_connection_credentials FROM authenticated, anon;
