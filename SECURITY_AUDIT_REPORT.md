# Finn — Phase 1 Security Audit & Hardening Report

> **Product**: Finn — Personal Finance OS  
> **Date**: September 14, 2026  
> **Scope**: Complete Phase 1 Security Audit & Hardening  
> **Status**: COMPLETED — READY FOR PHASE 2  
> **Gate Status**: **0 Unresolved Critical Findings** | **0 Unresolved High Findings**

---

## Executive Summary

A comprehensive application security audit and defensive hardening was conducted on Finn Phase 1 across authentication, Row Level Security (RLS), cross-user data isolation, foreign-key ownership integrity, secret and key exposure, demo mode access controls, input validation, error handling, session management, caching, and disaster recovery readiness.

All identified Critical and High severity vulnerabilities were remediated and verified through automated adversarial tests and Playwright E2E suites. The application now enforces strict multi-layered authorization at both the application and database tiers.

---

## 1. Security Findings Log

### Finding SEC-001
* **ID**: SEC-001
* **Severity**: **Critical**
* **Status**: **RESOLVED**
* **Location**: `src/lib/server/auth.ts`, `src/lib/supabase/middleware.ts`, `src/app/actions/auth.ts`
* **Description**: Unsigned and unverified session cookie allowed arbitrary client-side user impersonation. `getAuthenticatedUser()` and middleware parsed `finn_session` directly from client cookies using `JSON.parse` without HMAC verification or origin validation.
* **Attack Scenario**: An attacker could craft an HTTP request containing `Cookie: finn_session={"id":"victim-uuid","email":"victim@example.com"}`. The application would trust this payload and grant full access to the victim's accounts, transactions, and balances.
* **Existing Protection**: Only a `try-catch` around `JSON.parse`.
* **Fix**:
  1. Created cryptographic HMAC SHA-256 session signing and constant-time verification in `src/lib/server/session.ts` (`signSessionPayload`, `verifySessionToken`).
  2. Forged, malformed, or unsigned cookies are rejected immediately with constant-time comparison to prevent timing attacks.
  3. Demo sessions are restricted strictly to `DEMO_USER_ID` (`demo-user-fintech`) and gated by environment (`isDemoModeAllowed()`).
* **Verification**: Verified via automated test `tests/security/adversarial.test.ts` (Test 14) and Playwright E2E `e2e/security.spec.ts` (Test 2).

---

### Finding SEC-002
* **ID**: SEC-002
* **Severity**: **High**
* **Status**: **RESOLVED**
* **Location**: `src/lib/server/data-store.ts`, `src/app/actions/transactions.ts`
* **Description**: Foreign-key ownership bypass on transaction creation and update. In `createTransaction`, `category_id` was not validated for user ownership. In `updateTransaction`, `from_account_id`, `to_account_id`, `category_id`, `person_id`, and `merchant_id` were not validated against the authenticated user's records.
* **Attack Scenario**: User A creates or updates their own transaction and injects User B's secret bank account UUID or private category UUID into `from_account_id` or `category_id`. The transaction would be saved and link User B's resources to User A.
* **Existing Protection**: Partial validation on `from_account_id` and `to_account_id` only during initial creation; no ownership check on category or on any relations during update.
* **Fix**:
  1. Hardened `createTransaction` and `updateTransaction` in `src/lib/server/data-store.ts` to assert that every referenced entity (`from_account_id`, `to_account_id`, `person_id`, `merchant_id`, `category_id`) belongs to the authenticated user (or is an authorized system category).
  2. Created PostgreSQL database trigger `trg_check_transaction_ownership` in `supabase/migrations/20260914000001_security_hardening.sql` enforcing relational ownership at the database level.
* **Verification**: Verified via automated tests `tests/security/adversarial.test.ts` (Tests 5, 6, 7, 8, 9).

---

### Finding SEC-003
* **ID**: SEC-003
* **Severity**: **High**
* **Status**: **RESOLVED**
* **Location**: `src/lib/server/data-store.ts`
* **Description**: Missing user ID assertions allowed unauthenticated mutations if an empty string `""` was passed as `userId`.
* **Attack Scenario**: An unauthenticated or malformed request passing an empty string as user ID could create orphaned accounts or read rows where `user_id` was empty.
* **Existing Protection**: None; empty string was treated as a valid string identifier.
* **Fix**: Added `assertUserId(userId)` guard to every public data store method, ensuring a valid, non-empty string identifier is present.
* **Verification**: Verified via automated test `tests/security/adversarial.test.ts` (Test 10).

---

### Finding SEC-004
* **ID**: SEC-004
* **Severity**: **Medium**
* **Status**: **RESOLVED**
* **Location**: `src/lib/validation/schemas.ts`
* **Description**: Input validation weaknesses on financial numbers and text inputs:
  1. `Infinity` passed `z.coerce.number().positive()`.
  2. No upper limit on amount, creating overflow risks against PostgreSQL `NUMERIC(14, 2)`.
  3. `opening_balance` did not enforce finiteness.
* **Attack Scenario**: Submitting `amount: Infinity` or `amount: 1e30` could cause arithmetic errors, division-by-zero side effects, or database column overflow exceptions.
* **Existing Protection**: Basic `z.coerce.number().positive()` only.
* **Fix**:
  1. Added `MAX_MONEY_AMOUNT = 999_999_999_999.99` and `MIN_MONEY_AMOUNT = -999_999_999_999.99`.
  2. Enforced `Number.isFinite(v)` on all amount and balance schemas.
  3. Added `.trim()` and string bounds to all text inputs.
* **Verification**: Verified via automated test `tests/security/adversarial.test.ts` (Test 11).

---

### Finding SEC-005
* **ID**: SEC-005
* **Severity**: **Medium**
* **Status**: **RESOLVED**
* **Location**: `next.config.ts`
* **Description**: Missing standard HTTP security headers allowed potential clickjacking, MIME confusion attacks, and unconstrained referrer leakage.
* **Attack Scenario**: Malicious websites could embed Finn inside a hidden `<iframe>` to perform clickjacking attacks on financial actions.
* **Existing Protection**: Next.js default minimal headers.
* **Fix**: Configured global HTTP security headers in `next.config.ts`:
  * `X-Frame-Options: DENY`
  * `Content-Security-Policy: frame-ancestors 'none';`
  * `X-Content-Type-Options: nosniff`
  * `Referrer-Policy: strict-origin-when-cross-origin`
  * `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
  * `poweredByHeader: false`
* **Verification**: Verified via Playwright E2E test `e2e/security.spec.ts` (Test 3).

---

### Finding SEC-006
* **ID**: SEC-006
* **Severity**: **Medium**
* **Status**: **RESOLVED**
* **Location**: `src/app/actions/seed.ts`, `src/lib/server/session.ts`
* **Description**: Sample data seeding was ungated in production, allowing users or automated scripts to trigger bulk creation of test data.
* **Attack Scenario**: Accidental or malicious invocation of `seedSampleDataAction` could pollute real accounts with sample fixtures in production.
* **Existing Protection**: Seed action was authenticated, but permitted for any user in any environment.
* **Fix**: Added environment and user gating in `seedSampleDataAction`: in production, seeding is blocked unless demo mode is explicitly enabled or the user is the demo account.
* **Verification**: Verified via code inspection and test suite.

---

### Finding SEC-007
* **ID**: SEC-007
* **Severity**: **Low**
* **Status**: **RESOLVED**
* **Location**: `src/app/(dashboard)/layout.tsx`
* **Description**: Sensitive financial pages lacked explicit `force-dynamic` route configuration, risking accidental caching by Next.js edge caches or proxies.
* **Attack Scenario**: Under shared caching reverse proxies, a page containing user balance data might be cached and served to a subsequent user.
* **Existing Protection**: Dynamic rendering triggered by cookie consumption.
* **Fix**: Added explicit `export const dynamic = "force-dynamic";` in `src/app/(dashboard)/layout.tsx`.
* **Verification**: Production build verified `ƒ (Dynamic)` for all dashboard routes.

---

### Finding SEC-008
* **ID**: SEC-008
* **Severity**: **Low**
* **Status**: **RESOLVED**
* **Location**: `.env.example`
* **Description**: Unneeded `SUPABASE_SERVICE_ROLE_KEY` placeholder in `.env.example` could prompt developers to unnecessarily copy their elevated service-role key into environment files.
* **Fix**: Updated `.env.example` with clear documentation stating that service-role keys are never needed for ordinary user operations.
* **Verification**: Verified via file inspection.

---

### Finding SEC-009
* **ID**: SEC-009
* **Severity**: **Info**
* **Status**: **RESOLVED**
* **Location**: Documentation & Scripts
* **Description**: Absence of formal database backup/recovery guidelines for free-tier deployments.
* **Fix**: Created `docs/BACKUP_RECOVERY.md`, `scripts/backup-db.sh`, and updated `.gitignore` to prevent database dump leakage.
* **Verification**: Verified files and test execution.

---

## 2. Row Level Security (RLS) Audit by Table

| Table | RLS Status | SELECT Policy | INSERT Policy | UPDATE Policy | DELETE Policy | Foreign-Key Protection |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `profiles` | **Enabled** | `auth.uid() = id` | `auth.uid() = id` | `auth.uid() = id` | Denied (`false`) | Cascade on auth delete |
| `accounts` | **Enabled** | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | Enforced |
| `categories` | **Enabled** | `auth.uid() = user_id OR is_system` | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | System protected |
| `people` | **Enabled** | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | Enforced |
| `merchants` | **Enabled** | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | Enforced |
| `transactions` | **Enabled** | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | `auth.uid() = user_id` | `trg_check_transaction_ownership` |

---

## 3. Secret & Credential Exposure Audit

* **Repository History**: Scanned git history (`git log -S "ey"`); 0 committed JWT secrets, private keys, or credentials found.
* **Browser Code Inspection**: No occurrences of `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` or `NEXT_PUBLIC_SUPABASE_SECRET_KEY`.
* **Client Bundles**: Only public anon credentials (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) are exposed to client code.
* **Sensitive Data Minimization**: Account numbers are strictly masked (`••` + last 4 digits) across all views. PINs, CVVs, full card numbers, and banking passwords are never collected.

---

## 4. Demo Mode Audit

* **Isolation**: Demo user is restricted to a dedicated identity (`demo-user-fintech`).
* **Environment Gating**: In production, demo authentication is blocked unless `ENABLE_DEMO_MODE=true`.
* **Data Access**: Demo user has access only to their own seeded records; cross-user lookups and mutations against real users are rejected.
* **Credentials**: Demo mode does not use or expose elevated service-role privileges.

---

## 5. Automated Adversarial Test Results

The adversarial test suite (`tests/security/adversarial.test.ts`) verified the following 14 scenarios:

1. **User A cannot read User B account**: PASSED
2. **User A cannot read User B transaction**: PASSED
3. **User A cannot update User B transaction**: PASSED
4. **User A cannot delete User B transaction**: PASSED
5. **User A cannot use User B source account**: PASSED
6. **User A cannot use User B destination account**: PASSED
7. **User A cannot use User B category**: PASSED
8. **User A cannot use User B person**: PASSED
9. **User A cannot use User B merchant**: PASSED
10. **Unauthenticated mutation rejected**: PASSED
11. **Invalid amount rejected (negative, zero, NaN, Infinity, overflow)**: PASSED
12. **Same-account transfer rejected**: PASSED
13. **Demo user cannot access another user's real records**: PASSED
14. **Session cryptographic verification rejects forged or tampered cookies**: PASSED

---

## 6. Playwright E2E Security Verification

The E2E security test suite (`e2e/security.spec.ts`) verified:
1. **Unauthenticated route protection**: Unauthenticated attempts to access any of the 9 dashboard routes redirect to `/login`.
2. **Forged cookie rejection**: Malicious unsigned `finn_session` cookies are rejected by middleware and server auth.
3. **Security response headers**: Verified presence of `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-ancestors 'none'`, and `Referrer-Policy: strict-origin-when-cross-origin`.
4. **Account number masking**: Verified that no raw 10-digit account numbers appear unmasked in the DOM.

---

## 7. Phase 2 Readiness Gate

```text
=====================================================
          PHASE 2 SECURITY GATE: PASSED
=====================================================
  Critical Findings Unresolved: 0
  High Findings Unresolved:     0
  Medium Findings Unresolved:   0
  Low / Info Unresolved:        0

  Final Assessment: READY FOR PHASE 2
=====================================================
```
