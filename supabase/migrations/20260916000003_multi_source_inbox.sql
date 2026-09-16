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
    document_type       TEXT NOT NULL CHECK (document_type IN ('email', 'csv_statement', 'pdf_statement', 'statement_image', 'manual_upload', 'provider_document', 'api_response')),
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

-- ============================================================================
-- Cross-User Ownership Validation Triggers (Decision 1 & Operator Audit 6)
-- Enforces that all referenced entities belong to NEW.user_id across tables.
-- ============================================================================

-- 1. source_documents: connection_id must belong to NEW.user_id
CREATE OR REPLACE FUNCTION public.validate_source_document_ownership()
RETURNS TRIGGER AS $$
DECLARE
    v_conn_user_id UUID;
BEGIN
    IF NEW.connection_id IS NOT NULL THEN
        SELECT user_id INTO v_conn_user_id FROM public.source_connections WHERE id = NEW.connection_id;
        IF v_conn_user_id IS NULL OR v_conn_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cross-user integrity violation: source_connection % does not belong to user %',
                NEW.connection_id, NEW.user_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_validate_source_document_ownership ON public.source_documents;
CREATE TRIGGER trg_validate_source_document_ownership
    BEFORE INSERT OR UPDATE ON public.source_documents
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_source_document_ownership();

-- 2. import_batches: connection_id & source_document_id must belong to NEW.user_id
CREATE OR REPLACE FUNCTION public.validate_import_batch_ownership()
RETURNS TRIGGER AS $$
DECLARE
    v_conn_user_id UUID;
    v_doc_user_id UUID;
BEGIN
    IF NEW.connection_id IS NOT NULL THEN
        SELECT user_id INTO v_conn_user_id FROM public.source_connections WHERE id = NEW.connection_id;
        IF v_conn_user_id IS NULL OR v_conn_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cross-user integrity violation: source_connection % does not belong to user %',
                NEW.connection_id, NEW.user_id;
        END IF;
    END IF;
    IF NEW.source_document_id IS NOT NULL THEN
        SELECT user_id INTO v_doc_user_id FROM public.source_documents WHERE id = NEW.source_document_id;
        IF v_doc_user_id IS NULL OR v_doc_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cross-user integrity violation: source_document % does not belong to user %',
                NEW.source_document_id, NEW.user_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_validate_import_batch_ownership ON public.import_batches;
CREATE TRIGGER trg_validate_import_batch_ownership
    BEFORE INSERT OR UPDATE ON public.import_batches
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_import_batch_ownership();

-- 3. ingestion_items: source_document_id, connection_id, batch_id, matched_transaction_id must belong to NEW.user_id
CREATE OR REPLACE FUNCTION public.validate_ingestion_item_ownership()
RETURNS TRIGGER AS $$
DECLARE
    v_doc_user_id UUID;
    v_conn_user_id UUID;
    v_batch_user_id UUID;
    v_tx_user_id UUID;
BEGIN
    SELECT user_id INTO v_doc_user_id FROM public.source_documents WHERE id = NEW.source_document_id;
    IF v_doc_user_id IS NULL OR v_doc_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Cross-user integrity violation: source_document % does not belong to user %',
            NEW.source_document_id, NEW.user_id;
    END IF;

    IF NEW.connection_id IS NOT NULL THEN
        SELECT user_id INTO v_conn_user_id FROM public.source_connections WHERE id = NEW.connection_id;
        IF v_conn_user_id IS NULL OR v_conn_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cross-user integrity violation: source_connection % does not belong to user %',
                NEW.connection_id, NEW.user_id;
        END IF;
    END IF;

    IF NEW.batch_id IS NOT NULL THEN
        SELECT user_id INTO v_batch_user_id FROM public.import_batches WHERE id = NEW.batch_id;
        IF v_batch_user_id IS NULL OR v_batch_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cross-user integrity violation: import_batch % does not belong to user %',
                NEW.batch_id, NEW.user_id;
        END IF;
    END IF;

    IF NEW.matched_transaction_id IS NOT NULL THEN
        SELECT user_id INTO v_tx_user_id FROM public.transactions WHERE id = NEW.matched_transaction_id;
        IF v_tx_user_id IS NULL OR v_tx_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cross-user integrity violation: transaction % does not belong to user %',
                NEW.matched_transaction_id, NEW.user_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_validate_ingestion_item_ownership ON public.ingestion_items;
CREATE TRIGGER trg_validate_ingestion_item_ownership
    BEFORE INSERT OR UPDATE ON public.ingestion_items
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_ingestion_item_ownership();

-- 4. transaction_evidence: transaction_id, slip_id, ingestion_item_id must belong to NEW.user_id
CREATE OR REPLACE FUNCTION public.validate_transaction_evidence_ownership()
RETURNS TRIGGER AS $$
DECLARE
    v_tx_user_id UUID;
    v_slip_user_id UUID;
    v_item_user_id UUID;
BEGIN
    SELECT user_id INTO v_tx_user_id FROM public.transactions WHERE id = NEW.transaction_id;
    IF v_tx_user_id IS NULL OR v_tx_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Cross-user integrity violation: transaction % does not belong to user %',
            NEW.transaction_id, NEW.user_id;
    END IF;

    IF NEW.slip_id IS NOT NULL THEN
        SELECT user_id INTO v_slip_user_id FROM public.slips WHERE id = NEW.slip_id;
        IF v_slip_user_id IS NULL OR v_slip_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cross-user integrity violation: slip % does not belong to user %',
                NEW.slip_id, NEW.user_id;
        END IF;
    END IF;

    IF NEW.ingestion_item_id IS NOT NULL THEN
        SELECT user_id INTO v_item_user_id FROM public.ingestion_items WHERE id = NEW.ingestion_item_id;
        IF v_item_user_id IS NULL OR v_item_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cross-user integrity violation: ingestion item % does not belong to user %',
                NEW.ingestion_item_id, NEW.user_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

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

-- 5. reconciliation_runs: account_id & source_document_id must belong to NEW.user_id
CREATE OR REPLACE FUNCTION public.validate_reconciliation_run_ownership()
RETURNS TRIGGER AS $$
DECLARE
    v_account_user_id UUID;
    v_doc_user_id UUID;
BEGIN
    SELECT user_id INTO v_account_user_id FROM public.accounts WHERE id = NEW.account_id;
    IF v_account_user_id IS NULL OR v_account_user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Cross-user integrity violation: account % does not belong to user %',
            NEW.account_id, NEW.user_id;
    END IF;

    IF NEW.source_document_id IS NOT NULL THEN
        SELECT user_id INTO v_doc_user_id FROM public.source_documents WHERE id = NEW.source_document_id;
        IF v_doc_user_id IS NULL OR v_doc_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cross-user integrity violation: source_document % does not belong to user %',
                NEW.source_document_id, NEW.user_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_validate_reconciliation_run_ownership ON public.reconciliation_runs;
CREATE TRIGGER trg_validate_reconciliation_run_ownership
    BEFORE INSERT OR UPDATE ON public.reconciliation_runs
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_reconciliation_run_ownership();

-- ============================================================================
-- Atomic Ingestion Item -> Transaction Bridge RPC (Operator Audit 3)
-- ============================================================================
-- ============================================================================
-- Atomic Ingestion Item -> Transaction Bridge RPC (Hardened Security Definer)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_transaction_from_ingestion_item(
    p_user_id UUID,
    p_item_id UUID,
    p_tx_data JSONB
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
    v_item RECORD;
    v_tx RECORD;
    v_evidence RECORD;
    v_evidence_type TEXT;
    v_amount NUMERIC;
    v_type TEXT;
    v_date TIMESTAMPTZ;
    v_currency TEXT;
    v_desc TEXT;
    v_note TEXT;
    v_from_account UUID;
    v_to_account UUID;
    v_cat_id UUID;
    v_ref TEXT;
    v_acc RECORD;
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

    -- 2. Lock and validate Ingestion Item
    SELECT * INTO v_item
    FROM public.ingestion_items
    WHERE id = p_item_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ingestion item % not found for user %', p_item_id, p_user_id;
    END IF;

    IF v_item.status = 'linked' OR v_item.matched_transaction_id IS NOT NULL THEN
        RAISE EXCEPTION 'Ingestion item % is already linked to transaction %', p_item_id, v_item.matched_transaction_id;
    END IF;

    -- Check if item already has evidence even if status is pending
    IF EXISTS (
        SELECT 1 FROM public.transaction_evidence
        WHERE ingestion_item_id = p_item_id
    ) THEN
        RAISE EXCEPTION 'Ingestion item % already has associated transaction evidence', p_item_id;
    END IF;

    -- 3. Financial validation
    v_amount := (p_tx_data->>'amount')::NUMERIC;
    IF v_amount IS NULL OR v_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid amount: must be greater than zero';
    END IF;
    IF v_amount > 999999999999.99 THEN
        RAISE EXCEPTION 'Invalid amount: exceeds maximum allowable limit';
    END IF;

    v_type := p_tx_data->>'type';
    IF v_type IS NULL OR v_type NOT IN ('income', 'expense', 'transfer') THEN
        RAISE EXCEPTION 'Invalid transaction type %: imported items only support income, expense, or transfer', v_type;
    END IF;

    v_currency := p_tx_data->>'currency';
    IF v_currency IS NULL OR length(trim(v_currency)) = 0 THEN
        RAISE EXCEPTION 'Currency is required';
    END IF;

    v_date := (p_tx_data->>'transaction_date')::TIMESTAMPTZ;
    IF v_date IS NULL THEN
        RAISE EXCEPTION 'Invalid transaction_date: must be a valid timestamp';
    END IF;

    v_desc := COALESCE(p_tx_data->>'description', 'Imported transaction');
    v_note := p_tx_data->>'note';
    v_from_account := (p_tx_data->>'from_account_id')::UUID;
    v_to_account := (p_tx_data->>'to_account_id')::UUID;
    v_cat_id := (p_tx_data->>'category_id')::UUID;
    v_ref := COALESCE(p_tx_data->>'reference_number', v_item.reference_number);

    -- Strict direction invariants
    IF v_type = 'expense' THEN
        IF v_from_account IS NULL THEN
            RAISE EXCEPTION 'from_account_id is required for expense transaction';
        END IF;
        IF v_to_account IS NOT NULL THEN
            RAISE EXCEPTION 'Expense transaction cannot have to_account_id';
        END IF;
        SELECT * INTO v_acc FROM public.accounts WHERE id = v_from_account AND user_id = p_user_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Account % not found or does not belong to user %', v_from_account, p_user_id;
        END IF;
    ELSIF v_type = 'income' THEN
        IF v_to_account IS NULL THEN
            RAISE EXCEPTION 'to_account_id is required for income transaction';
        END IF;
        IF v_from_account IS NOT NULL THEN
            RAISE EXCEPTION 'Income transaction cannot have from_account_id';
        END IF;
        SELECT * INTO v_acc FROM public.accounts WHERE id = v_to_account AND user_id = p_user_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Account % not found or does not belong to user %', v_to_account, p_user_id;
        END IF;
    ELSIF v_type = 'transfer' THEN
        IF v_from_account IS NULL OR v_to_account IS NULL THEN
            RAISE EXCEPTION 'both from_account_id and to_account_id are required for transfer';
        END IF;
        IF v_from_account = v_to_account THEN
            RAISE EXCEPTION 'Transfer source and destination accounts must be different';
        END IF;
        SELECT * INTO v_acc FROM public.accounts WHERE id = v_from_account AND user_id = p_user_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Source account % not found or does not belong to user %', v_from_account, p_user_id;
        END IF;
        SELECT * INTO v_acc FROM public.accounts WHERE id = v_to_account AND user_id = p_user_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Destination account % not found or does not belong to user %', v_to_account, p_user_id;
        END IF;
    END IF;

    -- Atomically insert Transaction
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
        source,
        reference_number,
        confidence,
        review_status
    ) VALUES (
        p_user_id,
        v_type,
        v_amount,
        trim(v_currency),
        v_date,
        v_desc,
        v_note,
        v_from_account,
        v_to_account,
        v_cat_id,
        'import',
        v_ref,
        1.0,
        'confirmed'
    ) RETURNING * INTO v_tx;

    -- Determine evidence type
    IF v_item.item_type = 'email_notification' THEN
        v_evidence_type := 'email_notification';
    ELSIF v_item.item_type = 'statement_row' THEN
        v_evidence_type := 'statement_row';
    ELSE
        v_evidence_type := 'api_import';
    END IF;

    -- Atomically insert Evidence
    INSERT INTO public.transaction_evidence (
        user_id,
        transaction_id,
        ingestion_item_id,
        evidence_type
    ) VALUES (
        p_user_id,
        v_tx.id,
        v_item.id,
        v_evidence_type
    ) RETURNING * INTO v_evidence;

    -- Atomically update Ingestion Item with RETURNING
    UPDATE public.ingestion_items
    SET status = 'linked',
        matched_transaction_id = v_tx.id,
        updated_at = now()
    WHERE id = v_item.id
    RETURNING * INTO v_item;

    RETURN jsonb_build_object(
        'transaction', to_jsonb(v_tx),
        'evidence', to_jsonb(v_evidence),
        'item', to_jsonb(v_item)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_transaction_from_ingestion_item(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_transaction_from_ingestion_item(UUID, UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_transaction_from_ingestion_item(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transaction_from_ingestion_item(UUID, UUID, JSONB) TO service_role;

-- ============================================================================
-- Atomic Link Ingestion Item to Transaction RPC (Operator Finding 3)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.link_ingestion_item_to_transaction(
    p_user_id UUID,
    p_item_id UUID,
    p_transaction_id UUID
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
    v_item RECORD;
    v_tx RECORD;
    v_evidence RECORD;
    v_evidence_type TEXT;
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

    -- 2. Lock and validate Ingestion Item
    SELECT * INTO v_item
    FROM public.ingestion_items
    WHERE id = p_item_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ingestion item % not found for user %', p_item_id, p_user_id;
    END IF;

    IF v_item.status = 'linked' OR v_item.matched_transaction_id IS NOT NULL THEN
        RAISE EXCEPTION 'Ingestion item % is already linked to a transaction', p_item_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.transaction_evidence
        WHERE ingestion_item_id = p_item_id
    ) THEN
        RAISE EXCEPTION 'Ingestion item % already has associated transaction evidence', p_item_id;
    END IF;

    -- 3. Validate Target Transaction
    SELECT * INTO v_tx
    FROM public.transactions
    WHERE id = p_transaction_id AND user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target transaction % not found for user %', p_transaction_id, p_user_id;
    END IF;

    -- 4. Determine evidence type
    IF v_item.item_type = 'email_notification' THEN
        v_evidence_type := 'email_notification';
    ELSIF v_item.item_type = 'statement_row' THEN
        v_evidence_type := 'statement_row';
    ELSE
        v_evidence_type := 'api_import';
    END IF;

    -- 5. Atomically insert Evidence
    INSERT INTO public.transaction_evidence (
        user_id,
        transaction_id,
        ingestion_item_id,
        evidence_type
    ) VALUES (
        p_user_id,
        p_transaction_id,
        p_item_id,
        v_evidence_type
    ) RETURNING * INTO v_evidence;

    -- 6. Atomically update Ingestion Item with RETURNING
    UPDATE public.ingestion_items
    SET status = 'linked',
        matched_transaction_id = p_transaction_id,
        updated_at = now()
    WHERE id = p_item_id
    RETURNING * INTO v_item;

    RETURN jsonb_build_object(
        'evidence', to_jsonb(v_evidence),
        'item', to_jsonb(v_item)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.link_ingestion_item_to_transaction(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_ingestion_item_to_transaction(UUID, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_ingestion_item_to_transaction(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_ingestion_item_to_transaction(UUID, UUID, UUID) TO service_role;

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
