# FINN — Masked Account Pattern Intelligence & Safe Auto-Confirm Implementation Report

**Status**: Ready for Administrative Pre-Deployment Audit  
**Date**: 2026-09-16  
**Environment Verification**: Production Build Passed (`next build`), Vitest 226/226 Passed, Playwright 76/76 E2E Tests Passed  
**Production Migration Notice**: **MIGRATIONS HAVE NOT BEEN APPLIED TO PRODUCTION.** All SQL files are strictly staged under `supabase/migrations/` for administrative audit. **NO CODE HAS BEEN PUSHED TO REMOTE.**

---

## 1. Executive Summary & Core Safety Hardening

Following production audit feedback, the masked account pattern intelligence and auto-confirmation pipeline has been hardened with strict fail-closed protections before any database migrations are applied.

### Key Hardening Changes
1. **Strict Bank Scoping**: If a slip party has a recognized/non-empty bank (e.g. `KBANK`), candidate search is strictly constrained to accounts belonging to that institution. If the user has zero accounts for that bank, `matchOwnedAccount` returns `no_match` immediately. It will **never** resolve positionally, by suffix, or by name to an account at a different bank (e.g. an SCB account with the same trailing mask `1234`).
2. **Bank-Only Evidence Never Auto-Confirms**:
   - `matchMethod: "bank_only"` confidence is strictly capped at $\le 0.70$ (below the auto-confirm threshold).
   - In `confidence.ts`, an explicit whitelist (`AUTOCONFIRM_SAFE_MATCH_METHODS`) gates automatic creation. `bank_only`, `name_alias`, and `weak_pattern_match` are excluded from this whitelist, guaranteeing that weak or non-numeric evidence always routes to the Review Inbox (`needs_review`).
3. **Minimum Evidence Requirement for Positional Matching**:
   - Positional pattern matching requires at least 3 compatible shared digits (`sharedDigits >= 3`) to qualify as `positional_mask` (0.95 confidence, eligible for auto-confirm).
   - Patterns sharing only 1 or 2 visible digits are classified as `weak_pattern_match` (confidence capped at 0.70) and are strictly barred from auto-confirm.
4. **Backfill Learns Exclusively from Human-Verified Decisions**:
   - Historical transactions with `review_status = 'confirmed'` (which includes unverified auto-created transactions) are **NOT** used for alias backfill.
   - Backfill strictly targets human-edited/corrected transactions (`review_status = 'corrected'`), such as the verified 324 THB verification transaction.
5. **Truly Idempotent Backfill**:
   - Both the SQL migration and application backfill set deterministic counts (`confirmed_count = EXCLUDED.confirmed_count` in PostgreSQL, and non-incrementing assignment on backfill in application data stores). Rerunning the migration or backfill repeatedly on unchanged data produces the exact same count without inflation.
6. **Canonical Non-Null Institution Key (`UNKNOWN`)**:
   - In `public.account_match_aliases`, `institution` is `TEXT NOT NULL DEFAULT 'UNKNOWN'`, and data stores canonicalize null/empty banks to `"UNKNOWN"`. This ensures PostgreSQL's `UNIQUE (user_id, account_id, institution, normalized_masked_pattern)` constraint functions reliably and completely prevents duplicate alias spam.
7. **Isolated RPC Failure Domain (Post-RPC Protection)**:
   - If `confirmSlipTransaction` RPC succeeds, the transaction and slip state are authoritative.
   - If secondary job metadata update (`updateSlipJob`) encounters an issue, the error is logged as a warning; the system **never** downgrades the result to `needs_review` and returns `status: "created"` with the valid `transactionId`.
8. **Conservative Policy for Incoming External Funds**:
   - ALL external funds received into owned accounts require manual user confirmation (`needs_review`) to classify category and source. No automatic incoming classification is executed in this phase.
9. **Accurate Migration Documentation**:
   - Removed references to updating `confirm_slip_transaction` RPC status checks, as the processor pre-saves slip status as `'needs_review'` before invocation. The existing production RPC remains untouched.

---

## 2. Final Auto-Confirm-Safe Match Methods & Evidence Policy

The confidence engine ([`src/lib/slip/confidence.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/slip/confidence.ts)) enforces an explicit method whitelist:

```ts
export const AUTOCONFIRM_SAFE_MATCH_METHODS: readonly AccountMatchMethod[] = [
  "verified_alias",
  "positional_mask",
  "masked_suffix",
] as const;
```

### Evidence Hierarchy & Auto-Confirm Eligibility
| Evidence Level | Match Method | Confidence | Auto-Confirm Eligible? | Eligibility Criteria |
|:---|:---|:---|:---:|:---|
| **Level A** | `verified_alias` | **1.00** | **YES** | Exact bank + normalized positional mask matching user-verified alias in `account_match_aliases`. |
| **Level B (Strong)** | `positional_mask` | **0.95** | **YES** | Matching bank + identical pattern length + **at least 3 shared visible digits** + 0 contradictory digits. |
| **Level B (Weak)** | `weak_pattern_match` | **0.70** | **NO** | Only 1 or 2 shared visible digits. Routes to Review Inbox with account suggested. |
| **Level C** | `masked_suffix` | **0.90 – 0.95** | **YES** | Matching bank + trailing digits match ($\ge 3$ digits) + **slip pattern does not end in `'*'`**. |
| **Level D** | `name_alias` | **0.80** | **NO** | Party name matches account display name or alias. Routes to Review Inbox. |
| **Level E** | `bank_only` | **0.60 – 0.70** | **NO** | Single registered account at bank. **Always requires review.** Never auto-confirms. |
| **Ambiguous** | `ambiguous` | **0.30 – 0.50** | **NO** | Multiple candidate accounts matched at any level. Returns candidate IDs for manual review. |
| **No Match** | `no_match` | **0.00** | **NO** | No candidate found or bank has 0 user accounts. Routes to Review Inbox. |

---

## 3. Database Schema & Migration Changes

**File**: [`supabase/migrations/20260916000001_account_match_aliases.sql`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/supabase/migrations/20260916000001_account_match_aliases.sql)

### Table Schema: `public.account_match_aliases`
```sql
CREATE TABLE IF NOT EXISTS public.account_match_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    institution TEXT NOT NULL DEFAULT 'UNKNOWN',
    raw_masked_pattern TEXT,
    normalized_masked_pattern TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual_confirm',
    confirmed_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_account_match_aliases UNIQUE (user_id, account_id, institution, normalized_masked_pattern)
);
```

### Row-Level Security & Defense-in-Depth Trigger
- RLS enabled: `auth.uid() = user_id` for SELECT, INSERT, UPDATE, DELETE.
- Cross-entity trigger `check_alias_account_ownership()` verifies that `account_id` belongs to `user_id` on INSERT/UPDATE.

### Idempotent Backfill Query
```sql
-- Backfill expense & transfer sender patterns from human-verified transactions
INSERT INTO public.account_match_aliases (
    user_id, account_id, institution, raw_masked_pattern,
    normalized_masked_pattern, source, confirmed_count, created_at, updated_at
)
SELECT
    t.user_id,
    t.from_account_id,
    COALESCE(NULLIF(UPPER(TRIM(s.extracted_json->'sender'->>'bank')), ''), 'UNKNOWN'),
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
  AND t.review_status = 'corrected'
  AND s.status = 'created'
GROUP BY
    t.user_id,
    t.from_account_id,
    COALESCE(NULLIF(UPPER(TRIM(s.extracted_json->'sender'->>'bank')), ''), 'UNKNOWN'),
    s.extracted_json->'sender'->>'accountMasked',
    REGEXP_REPLACE(
        REGEXP_REPLACE(s.extracted_json->'sender'->>'accountMasked', '[- /.]', '', 'g'),
        '[xX•·_~#]', '*', 'g'
    )
ON CONFLICT (user_id, account_id, institution, normalized_masked_pattern)
DO UPDATE SET
    confirmed_count = EXCLUDED.confirmed_count,
    updated_at = NOW();
```

---

## 4. Post-RPC Isolation & Failure Domain Architecture

**File**: [`src/lib/slip/processor.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/slip/processor.ts)

```mermaid
sequenceDiagram
    participant P as SlipProcessor
    participant DS as DataStore (confirmSlipTransaction RPC)
    participant J as DataStore (updateSlipJob)

    P->>DS: confirmSlipTransaction(slipId, amount, ...)
    alt RPC Fails (e.g. connection timeout, lock contention)
        DS-->>P: Throw Error
        P->>J: updateSlipJob(status='needs_review', error='CONFIRM_RPC_FAILED')
        Note over P: Slip remains in needs_review with full extracted JSON intact.<br/>Zero financial transactions created.
        P-->>Client: return { status: 'needs_review', reviewUrl: ... }
    else RPC Succeeds
        DS-->>P: Return { transaction, already_confirmed }
        Note over P: Financial transaction is durable and authoritative.
        P->>J: updateSlipJob(status='created')
        alt Job Update Fails (non-fatal metadata error)
            J-->>P: Throw Error
            Note over P: Log warning only.<br/>DO NOT downgrade financial result.
        else Job Update Succeeds
            J-->>P: OK
        end
        P-->>Client: return { status: 'created', transactionId: tx.id }
    end
```

---

## 5. Verification & Test Suite Results

### 1. Vitest Unit & Integration Suite
- **18 Test Files Passed (18/18)**
- **226 Tests Passed (226/226)**
- File: [`tests/slip/slip-pattern-autoconfirm.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/slip/slip-pattern-autoconfirm.test.ts) testing all 15 required hardening scenarios:
  1. `known KBANK + only SCB same pattern -> no_match`: PASSED
  2. `bank_only never auto-confirms`: PASSED (confidence $\le 0.70$, routes to `needs_review`)
  3. `1 shared positional digit never auto-confirms`: PASSED (classified as `weak_pattern_match`, routes to `needs_review`)
  4. `2 shared digits never auto-confirms`: PASSED (classified as `weak_pattern_match`, routes to `needs_review`)
  5. `verified alias auto-confirms`: PASSED (creates transaction via atomic RPC)
  6. `strong bank-consistent positional evidence works safely`: PASSED ($\ge 3$ shared digits auto-confirms)
  7. `migration/backfill rerun does not inflate confirmed_count`: PASSED (rerun leaves count at 1)
  8. `NULL/unknown institution cannot create duplicate alias spam`: PASSED (canonicalized to `UNKNOWN`, unique constraint prevents duplicates)
  9. `old auto-created confirmed transaction is NOT used for backfill`: PASSED (`review_status='confirmed'` skipped)
  10. `corrected/manual verified transaction IS backfilled`: PASSED (`review_status='corrected'` learned)
  11. `RPC success + job update failure still returns created`: PASSED (does not downgrade successful financial creation)
  12. `RPC failure still creates zero transactions`: PASSED (fail-closed, slip safely preserved in `needs_review`)
  13. `incoming remains needs_review`: PASSED (conservative inflow policy enforced)
  14. `cross-user isolation unchanged`: PASSED (User A aliases invisible and unmatchable by User B)
  15. `existing 324 THB corrected transaction remains valid backfill candidate`: PASSED (successfully learned alias for MAKE by KBank)

### 2. Playwright End-to-End Suite
- **76 Tests Passed (76/76)** across both **Desktop Chrome** and **iPhone 11 Pro Max** (Mobile Viewport: 414x896)
- File: [`e2e/slip.spec.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/e2e/slip.spec.ts)
  - Settings Ingest Token lifecycle: PASSED
  - High-Confidence Outgoing Slip Auto-Creation: PASSED
  - Ambiguous Incoming Slip Routing & Edit/Confirm: PASSED
  - Exact File Duplicate Detection: PASSED
  - Mobile Layout & Zero Horizontal Overflow: PASSED

### 3. Production Build & Static Analysis
- `npm run typecheck`: **0 errors**
- `npm run lint`: **0 warnings, 0 errors**
- `npm run build`: **Compiled successfully in Next.js 15.5.25** with static & dynamic routes verified.

---

## 6. Pre-Deployment Audit Sign-Off

| Check | Status | Verification Detail |
|:---|:---:|:---|
| Bank Scoping | **VERIFIED** | Known bank never matches across different bank. Returns `no_match` if 0 accounts at bank. |
| Auto-Confirm Gating | **VERIFIED** | Only `verified_alias`, strong `positional_mask` ($\ge 3$ digits), and `masked_suffix` can auto-confirm. |
| Bank-Only Safety | **VERIFIED** | `bank_only` confidence capped at 0.70; barred from auto-confirm. |
| Positional Evidence Threshold | **VERIFIED** | $< 3$ shared digits classified as `weak_pattern_match` (0.70); barred from auto-confirm. |
| Backfill Selectivity | **VERIFIED** | Strictly queries `review_status = 'corrected'`; ignores historical auto `confirmed` transactions. |
| Backfill Idempotency | **VERIFIED** | SQL and application backfill set deterministic counts; rerunning does not inflate counts. |
| Database Uniqueness | **VERIFIED** | `institution TEXT NOT NULL DEFAULT 'UNKNOWN'` prevents multiple NULL duplicate accumulation. |
| Post-RPC Resilience | **VERIFIED** | Job update failures after RPC success do not downgrade status to `needs_review`. |
| Incoming Inflow Policy | **VERIFIED** | All incoming external transfers require human confirmation (`needs_review`). |
| Migration Staging | **VERIFIED** | **NO MIGRATIONS APPLIED TO PRODUCTION.** All SQL files staged in `supabase/migrations/`. |
| Version Control Safety | **VERIFIED** | **NO AUTOMATIC PUSH EXECUTED.** Staged for administrative review. |
