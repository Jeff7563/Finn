# FINN — Slip Confirmation RPC Security Hardening Report

**Security Status**: `PRODUCTION HARDENED (PRE-DEPLOYMENT AUDITED)`  
**Date**: September 16, 2026  
**Target Migration**: [`supabase/migrations/20260915000001_confirm_slips_realtime.sql`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/supabase/migrations/20260915000001_confirm_slips_realtime.sql)  
**Security & Verification Gate**: **100% PASSED** (0 Lint Warnings, 0 TypeScript Errors, 211/211 Vitest Tests Green across 17 suites, Production Build Succeeded, 76/76 Playwright E2E Green)  
**Deployment Note**: **MIGRATION HAS NOT BEEN APPLIED TO PRODUCTION** (as directed).

---

## 1. Executive Summary

This report documents the security audit and hardening of the atomic slip confirmation implementation before the migration is applied to production. The primary focus of this intervention is the `public.confirm_slip_transaction(...)` stored procedure and the application data layer in [`src/lib/server/supabase-data-store.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/server/supabase-data-store.ts).

### Key Hardening Measures Implemented:
1. **Privilege Lockdown**: Explicitly revoked all execute privileges from `PUBLIC` and `anon`. Granted execute exclusively to `authenticated` and `service_role`.
2. **Fail-Closed Caller Authentication**: Sealed the `auth.uid() = NULL` bypass. Normal authenticated calls strictly require `auth.uid() IS NOT NULL AND auth.uid() = p_user_id`. Any NULL caller without verified `service_role` JWT claims or session credentials is immediately rejected.
3. **Fixed Safe Search Path**: Enforced `SET search_path = pg_catalog, public` inside the `SECURITY DEFINER` function to eliminate search path hijacking and temporary schema masking. All database objects are explicitly schema-qualified.
4. **Restricted Domain & Inputs**: Restricted transaction types strictly to `income`, `expense`, and `transfer` (rejecting `adjustment`, `gift`, `refund`, etc.). Restricted `review_status` strictly to `confirmed` and `corrected`. Enforced positive finite amount bounds, valid date requirements, and account direction invariants.
5. **Ownership Defense-in-Depth**: Added explicit pre-insert validation inside the RPC ensuring that `from_account_id`, `to_account_id`, `category_id` (or system), `merchant_id`, and `person_id` belong to `p_user_id`. Preserved the existing `check_transaction_ownership` database trigger.
6. **Elimination of Non-Atomic Production Fallback**: Removed the 3-step application-level fallback (insert transaction -> update slip -> rollback delete) from `SupabaseDataStore`. In production Supabase mode, the PostgreSQL RPC is mandatory. Unavailability fails closed with `"ระบบยืนยันรายการยังไม่พร้อม กรุณาติดต่อผู้ดูแล"`.
7. **Idempotency & Concurrency Guarantees**: Preserved row-level pessimistic locking (`FOR UPDATE`), unique indexes on `source_slip_id` and `linked_transaction_id`, two-tier idempotency checks, and canonical `created` slip status.
8. **Migration Re-run Safety**: Confirmed that all DDL operations (`REPLICA IDENTITY FULL`, `CREATE UNIQUE INDEX IF NOT EXISTS`, conditional foreign key addition, idempotent realtime publication checks, and privilege revoke/grant) are fully idempotent.

---

## 2. Final SQL Security Model

Below is the complete, hardened definition of the `public.confirm_slip_transaction` function and privilege statements in [`supabase/migrations/20260915000001_confirm_slips_realtime.sql`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/supabase/migrations/20260915000001_confirm_slips_realtime.sql):

```sql
-- 4. Atomic PostgreSQL RPC for Slip Confirmation
-- Atomically locks slip, verifies caller identity & foreign entity ownership,
-- creates transaction, and updates slip status to canonical 'created'.
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
    -- Normal authenticated calls: auth.uid() MUST NOT be null and MUST equal p_user_id.
    -- Service role calls: explicitly verified via JWT role claim or current/session role.
    -- Anonymous or unverified callers are ALWAYS rejected.
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
    -- 2.1 Only workflow-appropriate transaction types allowed
    IF p_tx_type IS NULL OR p_tx_type NOT IN ('income', 'expense', 'transfer') THEN
        RAISE EXCEPTION 'Invalid transaction type %: confirmation only allows income, expense, or transfer', p_tx_type;
    END IF;

    -- 2.2 Only workflow-appropriate review statuses allowed
    v_review_status := COALESCE(p_review_status, 'confirmed');
    IF v_review_status NOT IN ('confirmed', 'corrected') THEN
        RAISE EXCEPTION 'Invalid review_status %: confirmation only allows confirmed or corrected', p_review_status;
    END IF;

    -- 2.3 Amount validation: positive and bounded
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid amount: must be greater than 0';
    END IF;
    IF p_amount > 999999999999.99 THEN
        RAISE EXCEPTION 'Invalid amount: exceeds maximum allowable limit';
    END IF;

    -- 2.4 Transaction date validation
    IF p_transaction_date IS NULL THEN
        RAISE EXCEPTION 'Transaction date is required';
    END IF;

    -- 2.5 Appropriate account requirements
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
    -- Validate that all referenced entities belong to p_user_id (or system category)
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

    -- 5. Idempotency Check 1: slip already has linked_transaction_id
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

    -- 6. Idempotency Check 2: transaction already exists for this source_slip_id
    SELECT * INTO v_existing_tx
    FROM public.transactions
    WHERE source_slip_id = p_slip_id AND user_id = p_user_id;

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

-- 10. Privilege Hardening: Revoke from PUBLIC and anon, grant only to authenticated and service_role
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
```

---

## 3. Production Data Layer Fail-Closed Hardening

In [`src/lib/server/supabase-data-store.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/server/supabase-data-store.ts), the multi-request fallback mechanism was completely eliminated.

### Before:
```typescript
// Previously fell back to:
// create transaction -> update slip -> delete transaction if update fails
```

### After:
```typescript
  // Atomic Slip Confirmation
  async confirmSlipTransaction(
    userId: string,
    input: ConfirmSlipTransactionInput
  ): Promise<ConfirmSlipTransactionResult> {
    assertUserId(userId);
    const client = await this.getClient(userId);

    // Call the atomic PostgreSQL RPC. In production Supabase mode, the RPC is mandatory.
    // If the RPC fails or is unavailable, fail closed! Never emulate atomicity with multiple network requests.
    const { data: rpcRes, error: rpcError } = await client.rpc(
      "confirm_slip_transaction",
      {
        p_slip_id: input.slipId,
        p_user_id: userId,
        p_tx_type: input.type,
        p_amount: Number(input.amount),
        p_currency: input.currency || "THB",
        p_transaction_date: input.transaction_date,
        p_description: input.description || null,
        p_note: input.note || null,
        p_from_account_id: input.from_account_id || null,
        p_to_account_id: input.to_account_id || null,
        p_category_id: input.category_id || null,
        p_merchant_id: input.merchant_id || null,
        p_person_id: input.person_id || null,
        p_reference_number: input.reference_number || null,
        p_confidence: input.confidence !== undefined ? input.confidence : 1.0,
        p_review_status: input.review_status || "confirmed",
      }
    );

    if (rpcError) {
      const errMsg = rpcError.message || "";
      if (
        errMsg.includes("could not find function") ||
        errMsg.includes("does not exist") ||
        errMsg.includes("schema cache")
      ) {
        throw new Error("ระบบยืนยันรายการยังไม่พร้อม กรุณาติดต่อผู้ดูแล");
      }
      throw new Error(errMsg);
    }

    if (!rpcRes || !rpcRes.transaction_id) {
      throw new Error("ระบบยืนยันรายการยังไม่พร้อม กรุณาติดต่อผู้ดูแล");
    }

    const tx = await this.getTransactionById(userId, rpcRes.transaction_id);
    if (!tx) {
      throw new Error("Failed to retrieve confirmed transaction");
    }

    return {
      transaction: tx,
      alreadyConfirmed: Boolean(rpcRes.already_confirmed),
    };
  }
```

---

## 4. Verification of 10 Security Requirements

A dedicated test suite was implemented in [`tests/security/slip-confirmation-security.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/security/slip-confirmation-security.test.ts) covering all 10 security mandates:

| # | Security Test Requirement | Implementation Proof | Result |
|---|---|---|---|
| 1 | **anon cannot execute confirmation RPC** | Verified explicit `REVOKE ... FROM PUBLIC` and `FROM anon`, absence of anon grants in migration, and execution-level fail-closed rejection for anonymous callers | **PASSED** |
| 2 | **authenticated User A cannot confirm User B slip** | Both Server Action `confirmSlipAction` and store call reject cross-user confirmation (`ไม่พบข้อมูลสลิปหรือคุณไม่มีสิทธิ์เข้าถึง`); 0 transactions created | **PASSED** |
| 3 | **null auth.uid() is rejected unless verified service_role** | Untrusted/empty/anon roles fail closed (`Access denied: unauthenticated caller`); verified `service_role` passes | **PASSED** |
| 4 | **arbitrary p_user_id cannot bypass ownership** | Verified that `auth.uid() != p_user_id` throws `Access denied: user_id does not match authenticated user` | **PASSED** |
| 5 | **adjustment/gift/etc are rejected by RPC** | Rejects `adjustment`, `gift`, `refund`, `loan_received`, `review_status: rejected/pending`, `amount <= 0`, empty dates, identical transfer accounts | **PASSED** |
| 6 | **foreign account IDs are rejected** | Foreign `from_account_id`, `to_account_id`, `category_id`, `merchant_id`, and `person_id` trigger explicit security violations; system categories permitted | **PASSED** |
| 7 | **production does NOT fallback when RPC is unavailable** | Mocked missing RPC throws safe localized error `"ระบบยืนยันรายการยังไม่พร้อม กรุณาติดต่อผู้ดูแล"`; 0 REST fallback calls made | **PASSED** |
| 8 | **RPC failure creates zero transactions** | Transaction counts before and after error are identical; slip status remains `needs_review` with `linked_transaction_id = null` | **PASSED** |
| 9 | **concurrent confirmation creates exactly one transaction** | 3 simultaneous confirmation requests return identical transaction ID; exactly 1 transaction created; slip status set to canonical `created` | **PASSED** |
| 10 | **valid expense/income/transfer confirmation works** | Expense (with `from_account_id`), income (with `to_account_id`), transfer (with both), and edited/corrected flows all confirm seamlessly | **PASSED** |

---

## 5. Verification Gate Results

### 1. `npm run typecheck` (`tsc --noEmit`)
```
> finn@0.1.0 typecheck
> tsc --noEmit

Exit code: 0 (0 errors)
```

### 2. `npm run lint` (`next lint`)
```
> finn@0.1.0 lint
> next lint

✔ No ESLint warnings or errors
Exit code: 0
```

### 3. `npm test` (`vitest run`)
```
 RUN  v3.2.7 C:/Users/Jeffy/OneDrive/Desktop/agy/finn

 ✓ tests/finance/calendar.test.ts (9 tests) 49ms
 ✓ tests/slip/slip-domain.test.ts (25 tests) 77ms
 ✓ tests/auth/jwt-clock-skew.test.ts (12 tests) 810ms
 ✓ tests/perf/perf.test.ts (3 tests) 46ms
 ✓ tests/security/adversarial.test.ts (14 tests) 284ms
 ✓ tests/auth/auth-recovery.test.ts (22 tests) 797ms
 ✓ tests/security/slip-confirmation-security.test.ts (10 tests) 268ms
 ✓ tests/slip/slip-timezone.test.ts (10 tests) 32ms
 ✓ tests/supabase/supabase-data-layer.test.ts (8 tests) 28ms
 ✓ tests/slip/slip-confirmation.test.ts (12 tests) 34ms
 ✓ tests/slip/slip-realtime.test.ts (9 tests) 97ms
 ✓ tests/security/slip-security.test.ts (9 tests) 21ms
 ✓ tests/slip/slip-vision.test.ts (46 tests) 626ms
 ✓ tests/finance/finance.test.ts (7 tests) 95ms
 ✓ tests/server/data-store.test.ts (4 tests) 15ms
 ✓ tests/perf/deduplication.test.ts (4 tests) 15ms
 ✓ tests/theme/theme.test.ts (7 tests) 9ms

 Test Files  17 passed (17)
      Tests  211 passed (211)
   Duration  9.84s
Exit code: 0
```

### 4. `npm run build` (`next build`)
```
   ▲ Next.js 15.5.25
   - Environments: .env.local

   Creating an optimized production build ...
 ✓ Compiled successfully in 29.3s
   Linting and checking validity of types ...
   Collecting page data ...
 ✓ Generating static pages (9/9)
   Finalizing page optimization ...
   Collecting build traces ...

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

Exit code: 0
```

### 5. `npx playwright test` (E2E Test Suite)
```
Running 76 tests using 1 worker
  76 passed (1.9m)
Exit code: 0
```

---

## 6. Bangkok Timezone Round-Trip Fix & Production Remediation

### 1. Root Cause Analysis of the 7-Hour Shift
- **Observed Production Incident**:
  - Thai bank slip visible time: `15 Sep 2026 20:08 Asia/Bangkok`.
  - Review Inbox displayed: `20:08` ✅
  - Private slip preview displayed: `20:08` ✅
  - After Edit & Confirm, Transactions displayed: `13:08` ❌ (7-hour regression; 13:08 UTC was interpreted as Bangkok time or converted twice).
- **Exact Mechanism of Failure**:
  1. `<input type="datetime-local">` outputs wall-clock datetime in the format `YYYY-MM-DDTHH:mm` with **no timezone designator**.
  2. Previously, JavaScript `new Date(editFormData.transaction_date).toISOString()` parsed the local string using the host machine's timezone. In UTC environments (or when slicing `toISOString().slice(0, 16)`), UTC `2026-09-15T13:08:00.000Z` was sliced into `"2026-09-15T13:08"`.
  3. When saved back, `"2026-09-15T13:08"` was interpreted as Bangkok local time (`13:08 Bangkok` = `06:08 UTC`). When formatted for display in Bangkok (+7), `06:08 UTC` became `13:08 Bangkok`, effectively subtracting 7 hours twice.
  4. In Direct Confirm vs. Edit & Confirm, direct confirm passed `ext.transactionDate` while Edit & Confirm passed the form string, causing disparate interpretations and generating false `slip_corrections` audit rows even when the user made no edits to the date.

### 2. Canonical Timezone Rules & Helpers
To guarantee deterministic round-trips regardless of browser or server runtime timezones:
1. **Rule**:
   - Thai bank slip visible time has no explicit timezone; it is **always** in `Asia/Bangkok` (UTC+7).
   - In Database: `transactions.transaction_date` is `TIMESTAMPTZ` (canonical UTC instant, e.g. `2026-09-15T13:08:00.000Z`).
   - In UI: `transaction_date` is **always** formatted in `Asia/Bangkok` (e.g. `20:08`).
   - In `<input type="datetime-local">`: value represents local wall-clock time in `Asia/Bangkok` (`YYYY-MM-DDTHH:mm`).
   - Conversion from datetime-local to canonical UTC instant happens **exactly once** via `bangkokDateTimeLocalToCanonicalInstant()`. If input already contains `Z` or an explicit timezone offset, it preserves the instant without reinterpreting UTC components as Bangkok local time.
   - Conversion from canonical UTC instant to datetime-local happens **exactly once** via `canonicalInstantToBangkokDateTimeLocal()`.
   - Direct Confirm and Edit & Confirm (with date unchanged) are mathematically guaranteed to produce the exact same UTC instant.
   - Unchanged edits compare canonicalized instants, preventing spurious `slip_corrections`.

2. **Core Helpers in `src/lib/finance/formatters.ts`**:
   - `canonicalInstantToBangkokDateTimeLocal(dateInput: string | Date, timeZone = "Asia/Bangkok"): string`: Formats UTC instant to `YYYY-MM-DDTHH:mm` in Bangkok time for form inputs. Corrects edge case where `en-CA` locale outputs `"24"` for midnight hour.
   - `bangkokDateTimeLocalToCanonicalInstant(datetimeLocalInput: string | Date | null | undefined): string | null`: Binds wall-clock components explicitly to `+07:00` (`YYYY-MM-DDTHH:mm:00.000+07:00`) before converting to UTC ISO string (`Z`).
   - `getBangkokLocalDateParts(dateInput: string | Date, timeZone = "Asia/Bangkok")`: Extracts Bangkok year, month (0-indexed), and day for monthly aggregations, preventing midnight transactions from crossing month boundaries.

### 3. Files Modified & Verification
- [`src/lib/finance/formatters.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/finance/formatters.ts): Implemented `canonicalInstantToBangkokDateTimeLocal`, `bangkokDateTimeLocalToCanonicalInstant`, and `getBangkokLocalDateParts`.
- [`src/components/slips/ReviewInboxClient.tsx`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/components/slips/ReviewInboxClient.tsx): Edit modal populates with `canonicalInstantToBangkokDateTimeLocal` and converts with `bangkokDateTimeLocalToCanonicalInstant`.
- [`src/app/actions/slip-review.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/app/actions/slip-review.ts): Both `confirmSlipAction` and `editAndConfirmSlipAction` canonicalize dates before passing to RPC; audit log compares canonicalized dates.
- [`src/app/actions/transactions.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/app/actions/transactions.ts): `createTransactionAction` and `updateTransactionAction` normalize `transaction_date` with `bangkokDateTimeLocalToCanonicalInstant`.
- [`src/components/transactions/TransactionForm.tsx`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/components/transactions/TransactionForm.tsx): Initializes `nowLocal` with `canonicalInstantToBangkokDateTimeLocal(new Date())`.
- [`src/components/transactions/TransactionDetailClient.tsx`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/components/transactions/TransactionDetailClient.tsx): Initializes edit default with `canonicalInstantToBangkokDateTimeLocal`.
- [`src/lib/finance/summaries.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/finance/summaries.ts): `calculateMonthSummary` and `calculateMonthlyTrends` use `getBangkokLocalDateParts` for Bangkok local calendar grouping.
- [`tests/slip/slip-timezone.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/slip/slip-timezone.test.ts): 10 unit and integration tests covering round-trips, midnight boundaries, Buddhist Era (BE 2569 -> 2026 CE), and direct/edit parity.

### 4. Production Data Recovery SQL
To correct the single test transaction created during verification that has the 7-hour shifted timestamp:

```sql
-- Production Data Remediation for Verification Slip
-- Target Slip visible time: 15 Sep 2026 20:08 Asia/Bangkok
-- Correct Canonical TIMESTAMPTZ: 2026-09-15 13:08:00+00 UTC
-- Run this in the Supabase SQL Editor:

UPDATE public.transactions
SET transaction_date = '2026-09-15 13:08:00+00'::timestamptz,
    updated_at = NOW()
WHERE source_slip_id = '<VERIFICATION_SLIP_ID>'
  AND user_id = '<USER_ID>';

-- Alternatively, if transaction ID is known directly:
-- UPDATE public.transactions
-- SET transaction_date = '2026-09-15 13:08:00+00'::timestamptz,
--     updated_at = NOW()
-- WHERE id = '<TRANSACTION_ID>';

-- Verification query:
SELECT id, transaction_date, transaction_date AT TIME ZONE 'Asia/Bangkok' as bangkok_time, review_status
FROM public.transactions
WHERE source_slip_id = '<VERIFICATION_SLIP_ID>';
-- Expected bangkok_time: 2026-09-15 20:08:00
```

---

## 7. Pre-Deployment Advisory

> [!IMPORTANT]
> The database migration [`supabase/migrations/20260915000001_confirm_slips_realtime.sql`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/supabase/migrations/20260915000001_confirm_slips_realtime.sql) is fully prepared, tested, and verified safe for re-running. It has **NOT** been applied to the production database as requested.

When ready to apply the migration to production:
1. Run `supabase db push` or apply the SQL file in the Supabase Dashboard SQL Editor.
2. Confirm the `confirm_slip_transaction` RPC appears under **Database > Functions** with permissions granted only to `authenticated` and `service_role`.
3. Verify that the production application successfully executes atomic confirmations via `SupabaseDataStore`.
