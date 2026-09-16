# Finn — Multi-Source Inbox Architecture & Transaction Evidence Bridge Implementation Report

**Status**: READY FOR OPERATOR AUDIT (Migration NOT applied to database, NO external APIs connected, NO automatic push)  
**Date**: 2026-09-16  
**Timezone**: Asia/Bangkok (+07:00)  
**Corpus**: Jeff7563/Finn  

---

## 1. Executive Summary & Table Reconciliation

### 1.1 Table Count Reconciled (Exactly 6 Tables)
The initial discrepancy between the architecture specification (6 tables) and earlier draft reports (5 tables) has been resolved. The migration file [`supabase/migrations/20260916000003_multi_source_inbox.sql`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/supabase/migrations/20260916000003_multi_source_inbox.sql) contains **EXACTLY 6 TABLES**:

1. **`public.source_connections`**:
   - Manages browser-visible provider connection metadata (Gmail, Google Drive, Bank Statement CSV/PDF, API, Manual).
   - **Zero-Token Architecture**: Strictly contains no OAuth secrets, tokens, or credential ciphertexts.
2. **`public.source_documents`**:
   - Ingested files/emails with storage tracking and retention fields (`storage_path`, `original_filename`, `file_hash`, `file_size`, `stored_file_size`, `is_pinned`, `binary_deleted_at`).
   - Supports non-destructive binary pruning: binary file pointer can be removed after retention expiry while keeping DB metadata, file hash, and evidence links intact.
3. **`public.import_batches`**:
   - Reconciled into the schema to track multi-file or multi-row batch lifecycle (`total_rows`, `processed_rows`, `duplicate_rows`, `failed_rows`, `status`).
4. **`public.ingestion_items`**:
   - Individual candidate transactions parsed from source documents, annotated with match class (`exact_duplicate`, `strong_match`, `possible_match`, `no_match`), confidence scores, candidate fingerprints, and parsed financial metadata.
5. **`public.transaction_evidence`**:
   - Poly-source evidence bridge linking transactions to either legacy Finn slips or new ingestion items.
   - Database-level check constraint: `((slip_id IS NOT NULL)::int + (ingestion_item_id IS NOT NULL)::int) = 1`.
   - Partial unique indexes ensuring a slip or ingestion item links to at most one transaction.
   - Trigger-enforced cross-user ownership integrity.
6. **`public.reconciliation_runs`**:
   - Immutable point-in-time audit snapshots comparing authoritative account statement balances against Finn's calculated balances.
   - RLS update policy revoked: snapshot data is append-only and never overwritten by subsequent backdated ledger changes.

---

## 2. Verification of All 8 Implementation Streams

All 8 implementation streams are fully implemented and verified in the codebase:

```
[Stream 1: Types & Migration]  ───────►  [Stream 2: Data Store Layer]
               │                                      │
               ▼                                      ▼
[Stream 5: CSV Parser]         ───────►  [Stream 3: Dedup Engine]
               │                                      │
               ▼                                      ▼
[Stream 6: Storage Retention]  ───────►  [Stream 8: Inbox UI & Actions]
               │                                      │
               ▼                                      ▼
[Stream 7: Provider Stubs]     ───────►  [Stream 4: Reconciliation]
```

### Stream 1: Types, Migration & Validation
- **Schema File**: [`supabase/migrations/20260916000003_multi_source_inbox.sql`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/supabase/migrations/20260916000003_multi_source_inbox.sql)
- **TypeScript Types**: [`src/types/multi-source.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/types/multi-source.ts)
- **Zod Schemas**: [`src/lib/validation/multi-source-schemas.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/validation/multi-source-schemas.ts)
- **Validation Tests**: [`tests/validation/multi-source-schemas.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/validation/multi-source-schemas.test.ts) (11 tests pass)

### Stream 2: Data Store Layer (Poly-Source Interface)
- **Interface**: [`src/lib/server/data-store-interface.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/server/data-store-interface.ts)
- **In-Memory Store**: [`src/lib/server/memory-data-store.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/server/memory-data-store.ts)
- **Supabase Store**: [`src/lib/server/supabase-data-store.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/server/supabase-data-store.ts)
- **Delegator**: [`src/lib/server/data-store.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/server/data-store.ts)
- Full CRUD operations implemented for `SourceConnection`, `SourceDocument`, `ImportBatch`, `IngestionItem`, `TransactionEvidence`, and `ReconciliationRun`.

### Stream 3: Deduplication Engine (Separating Strong from Weak Signals)
- **Implementation**: [`src/lib/ingestion/deduplication.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/ingestion/deduplication.ts)
- **Tests**: [`tests/ingestion/deduplication.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/ingestion/deduplication.test.ts) (11 tests pass), [`tests/perf/deduplication.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/perf/deduplication.test.ts) (4 tests pass)
- **4 Result Classes**: `exact_duplicate`, `strong_match`, `possible_match`, `no_match`.
- **Auto-link Restriction**: Auto-linking is strictly permitted ONLY on scoped strong identifiers (provider external ID scoped to user + connection, exact file SHA-256, transaction reference scoped by institution + account + direction).
- **Financial Safety**: Weak signals (account + amount + timestamp, merchant + amount) are capped at confidence $\le 0.85$ as `possible_match` with `matchedTransactionId = null`, forcing manual operator review in the Inbox.

### Stream 4: Reconciliation Audit Snapshots
- **Implementation**: [`src/lib/finance/reconciliation.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/finance/reconciliation.ts), [`src/lib/finance/balances.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/finance/balances.ts)
- **Tests**: [`tests/finance/reconciliation-snapshot.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/finance/reconciliation-snapshot.test.ts) (10 tests pass)
- **Balance Calculation**: Implements `calculateAccountBalanceAt(account, transactions, targetInstant)` strictly filtering transactions into $(balance\_as\_of, targetInstant]$. If $target < balance\_as\_of$, safely returns `cannot_calculate_safely` without fabricating historical deltas.
- **Audit Immutability**: Historical reconciliation runs freeze the snapshot state; subsequent backdated transactions never overwrite old runs.

### Stream 5: Bank Statement CSV Parser
- **Implementation**: [`src/lib/ingestion/csv-parser.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/ingestion/csv-parser.ts)
- **Tests**: [`tests/ingestion/csv-parser.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/ingestion/csv-parser.test.ts) (5 tests pass)
- Supports Thai bank exports (KBANK, SCB, BBL, BAY, KKP) with separate withdrawal/deposit columns or signed single amount columns, parsing into satang integers without floating point drift.

### Stream 6: Storage Retention & Image Optimization
- **Implementation**: [`src/lib/storage/retention.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/storage/retention.ts)
- **Tests**: [`tests/storage/storage-retention.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/storage/storage-retention.test.ts) (9 tests pass)
- **Retention Rules**: Unpinned documents older than 90 days are cleanup candidates; pinned documents are never eligible for deletion.
- **Metadata Preservation**: Binary deletion zeroes `storage_path` and `stored_file_size`, records `binary_deleted_at`, but keeps document record, `original_filename`, `file_hash`, and evidence links intact.
- **No Image Upscaling**: If image dimensions are within target maximum bounds, original resolution is preserved without upscaling.

### Stream 7: Provider Architecture Stubs
- **Implementation**: [`src/lib/providers/provider-stubs.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/providers/provider-stubs.ts)
- **Tests**: [`tests/providers/provider-stubs.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/providers/provider-stubs.test.ts) (9 tests pass)
- **Zero-Token Safety**: `assertNoCredentials` recursively scans configuration payloads and rejects any keys matching `token`, `access_token`, `refresh_token`, `secret`, `password`, or `private_key`.
- **Idempotent Ingestion**: Stubs verify Gmail message ID and Drive file modified-time tracking to prevent re-processing duplicates.

### Stream 8: Unified Multi-Source Inbox UI & Server Actions
- **Server Actions**: [`src/app/actions/inbox.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/app/actions/inbox.ts) (`linkIngestionItemAction`, `createTransactionFromItemAction`, `dismissIngestionItemAction`, `rejectIngestionItemAction`)
- **UI Client**: [`src/components/inbox/UnifiedInboxClient.tsx`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/components/inbox/UnifiedInboxClient.tsx)
- **Page Route**: [`src/app/(dashboard)/inbox/page.tsx`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/app/%28dashboard%29/inbox/page.tsx)
- **Navigation**: Linked in [`Sidebar.tsx`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/components/navigation/Sidebar.tsx) and [`MobileBottomNav.tsx`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/components/navigation/MobileBottomNav.tsx)
- **E2E Test**: [`e2e/inbox.spec.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/e2e/inbox.spec.ts) (passes in Desktop Chrome and Mobile iPhone)
- **Safety Standard**: Explicitly eliminates ambiguous "Confirm All" buttons; each candidate item requires discrete user verification.

---

## 3. Comprehensive Test Scenario Mapping Table (All 32 Required Scenarios)

| # | Scenario | Test File | Exact Test Name | Result |
|:---:|:---|:---|:---|:---:|
| 1 | Exact external ID dedupe | `tests/ingestion/deduplication.test.ts` | `classifies as strong_match when external ID matches within the same provider connection` | **PASS** |
| 2 | Exact reference dedupe | `tests/ingestion/deduplication.test.ts` | `classifies as strong_match ONLY when reference number has verified scope (institution + direction)` | **PASS** |
| 3 | Same amount/day different purchases do NOT merge | `tests/ingestion/deduplication.test.ts` | `produces possible_match even for IDENTICAL amount + EXACT SAME SECOND` | **PASS** |
| 4 | Slip + Gmail + statement → 1 tx / 3 evidence | `tests/evidence/transaction-evidence.test.ts` | `achieves 1 Transaction with 3 Evidence rows (slip + gmail + statement row) without altering legacy slips` | **PASS** |
| 5 | Cross-user evidence link blocked | `tests/evidence/transaction-evidence.test.ts` | `enforces cross-user ownership integrity: strictly rejects linking cross-user records` | **PASS** |
| 6 | Historical statement before baseline does not change balance | `tests/finance/import-balance-scenarios.test.ts` | `preserves authoritative baseline: imports prior to balance_as_of do NOT alter calculated balance` | **PASS** |
| 7 | Historical row remains in report | `tests/finance/import-balance-scenarios.test.ts` | `preserves authoritative baseline: imports prior to balance_as_of do NOT alter calculated balance` | **PASS** |
| 8 | Post-baseline import changes balance once | `tests/finance/import-balance-scenarios.test.ts` | `reflects post-baseline imported transaction in current balance calculation` | **PASS** |
| 9 | Transfer remains transfer | `tests/finance/import-balance-scenarios.test.ts` | `decrements from_account_id and increments to_account_id simultaneously without category requirement` | **PASS** |
| 10 | Reconciliation exact match | `tests/finance/reconciliation-snapshot.test.ts` | `creates 'balanced' snapshot when calculated_balance == authoritative_balance` | **PASS** |
| 11 | Reconciliation positive difference | `tests/finance/reconciliation-snapshot.test.ts` | `creates 'difference_found' snapshot when calculated_balance != authoritative_balance` | **PASS** |
| 12 | Reconciliation negative difference | `tests/finance/import-balance-scenarios.test.ts` | `handles balanced, positive difference (statement > calculated), and negative difference (statement < calculated)` | **PASS** |
| 13 | No fake adjustment transaction | `tests/finance/import-balance-scenarios.test.ts` | `creates reconciliation audit run without modifying ledger or creating synthetic adjustment transactions` | **PASS** |
| 14 | Target after baseline | `tests/finance/reconciliation-snapshot.test.ts` | `target > balance_as_of -> opening_balance + transactions in (balance_as_of, target]` | **PASS** |
| 15 | Target exactly baseline | `tests/finance/reconciliation-snapshot.test.ts` | `target == balance_as_of -> exactly opening_balance` | **PASS** |
| 16 | Target before baseline cannot calculate | `tests/finance/reconciliation-snapshot.test.ts` | `target < balance_as_of -> cannot_calculate_safely (No fake reconstruction)` | **PASS** |
| 17 | Bangkok timestamp conversion | `tests/ingestion/csv-parser.test.ts` | `Scenario 17: Bangkok timestamp conversion (handles Thai Buddhist year 2569 -> 2026 and DD/MM/YYYY)` | **PASS** |
| 18 | CSV debit | `tests/ingestion/csv-parser.test.ts` | `Scenario 18: CSV debit (withdrawal column maps to outgoing expense in satang)` | **PASS** |
| 19 | CSV credit | `tests/ingestion/csv-parser.test.ts` | `Scenario 19: CSV credit (deposit column maps to incoming income in satang)` | **PASS** |
| 20 | CSV malformed row → review | `tests/ingestion/csv-parser.test.ts` | `Scenario 20: CSV malformed row -> review (skips zero-amount/header rows and preserves raw row for review)` | **PASS** |
| 21 | Duplicate CSV import idempotent | `tests/finance/import-balance-scenarios.test.ts` | `detects exact duplicate CSV statements via file hash and prevents double-processing` | **PASS** |
| 22 | Drive unchanged file not reprocessed | `tests/providers/provider-stubs.test.ts` | `detects if a Drive file is unchanged using fileId and modifiedTime (idempotency)` | **PASS** |
| 23 | Gmail same message ID not reprocessed | `tests/providers/provider-stubs.test.ts` | `detects and prevents reprocessing of the same Gmail message ID (idempotency)` | **PASS** |
| 24 | Failed/duplicate storage cleanup candidate | `tests/storage/storage-retention.test.ts` | `marks failed temporary documents older than 7 days as eligible for cleanup` | **PASS** |
| 25 | Confirmed evidence retained by default | `tests/storage/storage-retention.test.ts` | `retains confirmed evidence files as long as they are within the retention window` | **PASS** |
| 26 | Pinned evidence never cleanup candidate | `tests/storage/storage-retention.test.ts` | `never cleans up pinned documents, even if years old` | **PASS** |
| 27 | Binary deletion preserves DB metadata/evidence | `tests/storage/storage-retention.test.ts` | `prunes binary pointer and records timestamp while preserving filename, hash, and metadata` | **PASS** |
| 28 | Original hash survives optimization | `tests/storage/storage-retention.test.ts` | `preserves original cryptographic hash across optimization steps` | **PASS** |
| 29 | No image upscaling | `tests/storage/storage-retention.test.ts` | `does not upscale images smaller than the maximum target dimension` | **PASS** |
| 30 | Existing slip auto-confirm regression | `tests/slip/slip-pattern-autoconfirm.test.ts` | `Masked Account Pattern Intelligence & Safe Auto-Confirm Hardening (15 Required Scenarios)` | **PASS** |
| 31 | Existing balance baseline regression | `tests/finance/balance-baseline.test.ts` | `Finn — Balance Baseline Final Fail-Closed Validation Suite` | **PASS** |
| 32 | Existing Playwright regression | `e2e/flows.spec.ts`, `e2e/theme.spec.ts`, `e2e/slip.spec.ts` | `Phase 1 Core Financial Flows`, `Phase 2 — Slip Automation End-to-End`, `Adaptive Theme` | **PASS** |

---

## 4. Verification Gate Results

All 5 verification gates have passed completely:

```
[Gate 1: ESLint]          ──► PASS  (0 errors, 0 warnings)
[Gate 2: TypeScript]      ──► PASS  (tsc --noEmit exited 0)
[Gate 3: Vitest Unit]     ──► PASS  (27 test files, 341 tests passed)
[Gate 4: Next.js Build]   ──► PASS  (Compiled 24 routes + dynamic inbox route)
[Gate 5: Playwright E2E]  ──► PASS  (78 tests passed on Desktop & Mobile)
```

### Detailed Gate Audit Log:

1. **Lint Gate (`npm run lint`)**:
   - Result: `✔ No ESLint warnings or errors`
   - Exit code: 0

2. **Typecheck Gate (`npm run typecheck`)**:
   - Result: `tsc --noEmit` exited with code 0 (no type errors across whole codebase)
   - Exit code: 0

3. **Unit & Integration Test Suite (`npm test`)**:
   - Result: 27 test files passed, 341 tests passed (0 failed).
   - Exit code: 0

4. **Production Build (`npm run build`)**:
   - Result: Next.js 15.5 compiled all routes cleanly.
   - Dynamic `/inbox` route successfully bundled with shared chunks.
   - Exit code: 0

5. **End-to-End Suite (`npx playwright test`)**:
   - Result: 78 tests passed across Desktop Chrome and iPhone 11 Pro Max.
   - Includes new dedicated E2E test `e2e/inbox.spec.ts` testing the Multi-Source Inbox client, financial safety notice, and navigation drawer links.
   - Exit code: 0

---

## 5. Mandatory Safety & Non-Action Compliance

In strict compliance with operator audit requirements:

- [x] **DO NOT APPLY MIGRATIONS**:
  - The migration file `supabase/migrations/20260916000003_multi_source_inbox.sql` remains **UNAPPLIED** to any remote database.
  - All automated tests were executed using `MemoryDataStore` or mock database instances.
- [x] **DO NOT CONNECT REAL GMAIL/DRIVE**:
  - No real OAuth client IDs, client secrets, or user tokens were configured or persisted.
  - Architecture relies on zero-token connection stubs and synthetic metadata assertions.
- [x] **DO NOT PUSH AUTOMATICALLY**:
  - No `git push` or remote deployment command was executed.
  - All changes remain local on the working tree ready for operator inspection.
- [x] **STOPPING FOR OPERATOR AUDIT**:
  - Execution paused to await operator review and manual approval.
