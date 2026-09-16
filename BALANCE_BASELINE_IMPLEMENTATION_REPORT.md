# Finn — Balance Baseline / As-Of Balance Architecture Implementation Report

**Status**: READY FOR OPERATOR AUDIT (Migration NOT applied to production, NO automatic push)  
**Date**: 2026-09-16  
**Timezone**: Asia/Bangkok (+07:00)  

---

## 1. Executive Summary & Problem Resolution

### The Problem
Previously in Finn, account balances were calculated as:
$$\text{opening\_balance} + \sum_{\text{all historical transactions}} \Delta_{\text{tx}} = \text{current\_balance}$$

When a user synchronized an authoritative account balance (e.g. 687.04 THB as of today 11:30 Bangkok) and later imported past receipts, slips, or bank export rows from weeks or months prior, the balance calculation subtracted those historical expenses again, corrupting the current balance even though the authoritative balance had already factored them in.

### The Solution: Balance Baseline (`balance_as_of`)
Finn now treats `opening_balance` as the **authoritative balance as of `balance_as_of`**.
- **Inclusive Baseline Rule**: Any transaction with `transaction_date <= balance_as_of` is treated as already encompassed within the baseline and does **NOT** modify `current_balance`.
- **Active Incremental Rule**: Only transactions strictly after `balance_as_of` (`transaction_date > balance_as_of`) modify `current_balance`.
- **Historical Integrity Preserved**: Transactions prior to `balance_as_of` remain fully visible in transaction history, search, monthly overview reports, category analytics, calendar insights, people/counterparties, and `transaction_count`.
- **Independent Account Baselines**: Each account manages its own baseline independently. Transfers between accounts with different baselines evaluate eligibility per account without cross-contamination.
- **Legacy Compatibility**: Accounts with `balance_as_of IS NULL` continue to operate with traditional Finn calculation (all transactions included).

---

## 2. Verification Summary

All verification gates have passed with zero warnings or errors:

| Check | Result | Details |
|---|---|---|
| **Balance Baseline Test Suite** | **PASS (22/22)** | All 22 required product scenarios verified in [`tests/finance/balance-baseline.test.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/tests/finance/balance-baseline.test.ts) |
| **Complete Unit & Integration Suite** | **PASS (256/256)** | All 19 test suites passing (vitest) |
| **Playwright E2E Suite** | **PASS (76/76)** | Desktop Chrome & Mobile iPhone 11 Pro Max passing |
| **TypeScript Typecheck** | **PASS (0 errors)** | `tsc --noEmit` exited with code 0 |
| **ESLint Validation** | **PASS (0 errors)** | `next lint` verified cleanly |
| **Next.js Production Build** | **PASS (0 errors)** | `next build` compiled all routes and server actions |

---

## 3. Detailed Verification of the 22 Required Scenarios

| # | Scenario | Status | Verification Detail |
|---|---|:---:|---|
| 1 | Legacy account without `balance_as_of` | PASS | Account with `balance_as_of: null` preserves traditional calculation (`opening_balance + income - expense`). |
| 2 | Baseline 1,000 + expense 200 before baseline | PASS | Current balance remains 1,000 THB; expense is not subtracted again. |
| 3 | Baseline 1,000 + expense 100 after baseline | PASS | Current balance becomes 900 THB (`1000 - 100`). |
| 4 | Exact equality (`transaction_date == balance_as_of`) | PASS | Evaluated as pre-baseline (inclusive baseline), ignored for balance calculation. |
| 5 | Old income before baseline | PASS | Income before baseline does not inflate current balance. |
| 6 | Historical transactions in `transaction_count` | PASS | `calculateAccountBalance` counts all associated transactions while filtering balance adjustments. |
| 7 | Historical transactions in Monthly Summary | PASS | `calculateMonthSummary` includes pre-baseline transactions in historical months. |
| 8 | Historical expenses in Category Analytics | PASS | `calculateCategorySummaries` includes pre-baseline transactions in spending breakdowns. |
| 9 | Old internal transfer with independent baselines | PASS | Source account (post-baseline) does not deduct; destination account (pre-baseline) adds appropriately. |
| 10 | New internal transfer after both baselines | PASS | Source decrements, destination increments, overall income/expense totals remain 0. |
| 11 | Historical slip before baseline | PASS | Creating a slip transaction with past date does not change current balance. |
| 12 | Post-baseline slip transaction | PASS | Modifies current balance exactly once. |
| 13 | Date edited from before -> after baseline | PASS | Transaction dynamically shifts from excluded to included in current balance. |
| 14 | Date edited from after -> before baseline | PASS | Transaction dynamically shifts from included to excluded in current balance. |
| 15 | Deleting historical pre-baseline transaction | PASS | Current balance remains untouched; transaction count decrements by 1. |
| 16 | Deleting post-baseline transaction | PASS | Current balance recalculates accurately. |
| 17 | Bangkok `datetime-local` round-trip | PASS | Wall-clock `YYYY-MM-DDTHH:mm` round-trips to UTC ISO and back without timezone shifts. |
| 18 | Bangkok midnight boundary handling | PASS | 23:59:59 (excluded) vs 00:00:00 (excluded) vs 00:00:01 (included) verified accurately. |
| 19 | Total active balance calculation | PASS | `calculateTotalActiveBalance` sums all active accounts using each account's baseline. |
| 20 | Multiple accounts with independent baseline dates | PASS | Mid-month transactions affect earlier baseline accounts while ignoring later baseline accounts. |
| 21 | Existing MAKE by KBank account (legacy) | PASS | Null baseline preserves 100% backward compatibility. |
| 22 | DataStore & Schema validation | PASS | Validates ISO strings, Bangkok datetimes, null, empty string; Memory & Supabase stores verified. |

---

## 4. Modified & Created Files

### Database Migration (Pending Operator Deployment)
- [`supabase/migrations/20260916000002_balance_baseline.sql`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/supabase/migrations/20260916000002_balance_baseline.sql)
  - Adds `balance_as_of TIMESTAMPTZ NULL` to `public.accounts`.
  - Non-destructive, idempotent (`ADD COLUMN IF NOT EXISTS`).
  - Does NOT alter or populate existing rows (existing accounts retain `balance_as_of = NULL`).

### Domain & Business Logic
- [`src/types/finance.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/types/finance.ts)
  - Added `balance_as_of?: string | null;` to `Account`.
- [`src/lib/validation/schemas.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/validation/schemas.ts)
  - Added `balance_as_of` validation to `accountSchema`.
- [`src/lib/finance/balances.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/finance/balances.ts)
  - Implemented `doesTransactionAffectAccountBalance(account, transaction): boolean`.
  - Updated `calculateAccountBalance` to decouple transaction counting from balance modification.

### Data Layer & Server Actions
- [`src/lib/server/memory-data-store.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/server/memory-data-store.ts)
  - Added `balance_as_of` to account creation and partial updates.
- [`src/lib/server/supabase-data-store.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/lib/server/supabase-data-store.ts)
  - Added `balance_as_of` mapping and persistence to Supabase.
- [`src/app/actions/accounts.ts`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/app/actions/accounts.ts)
  - Converted `<input type="datetime-local">` submissions using `bangkokDateTimeLocalToCanonicalInstant`.

### User Interface Components
- [`src/components/accounts/AccountsClient.tsx`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/components/accounts/AccountsClient.tsx)
  - Added baseline toggle ("ยอดตั้งต้นทั่วไป" vs "กำหนดยอดคงเหลือ ณ วันที่/เวลา").
  - Added `datetime-local` input with Thai helper text: *"รายการก่อนหรือเท่ากับเวลานี้จะยังอยู่ในประวัติ แต่จะไม่ถูกนำมาคำนวณยอดคงเหลือปัจจุบันซ้ำ"*.
- [`src/components/ui/AccountCard.tsx`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/components/ui/AccountCard.tsx)
  - Displays `ยอดอ้างอิง: ฿... ณ [วันที่/เวลา]` if `balance_as_of` is configured.
- [`src/components/ui/TransactionItem.tsx`](file:///C:/Users/Jeffy/OneDrive/Desktop/agy/finn/src/components/ui/TransactionItem.tsx)
  - Displays subtle `"ก่อนจุดอ้างอิงยอดคงเหลือ"` badge for transactions on or before the account baseline.

---

## 5. Deployment Instructions for Operators

When ready to deploy to production:

```bash
# 1. Apply the idempotent balance baseline migration via Supabase CLI
supabase db push

# 2. Verify column existence in Supabase SQL editor (if needed)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'accounts' AND column_name = 'balance_as_of';

# 3. Deploy Next.js web application
git add .
git commit -m "feat(finance): balance baseline and as-of balance architecture"
git push origin main
```
