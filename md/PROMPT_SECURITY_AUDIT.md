# PROMPT_SECURITY_AUDIT.md
# Agent Prompt — Finn Phase 1 Security Audit & Hardening

You are a senior application security engineer and senior full-stack engineer.

You are auditing an EXISTING application:

> Finn — Personal Finance OS

The product already has:
- working Phase 1 finance core
- Supabase Auth
- PostgreSQL / Supabase
- RLS migrations
- UI V2
- Overview Calendar
- deterministic finance tests
- Playwright tests

Your task is NOT to redesign the app.

Your task is to audit and harden the current Phase 1 implementation using the attached:

- `PRODUCT_SPEC.md`
- `SECURITY_SPEC.md`

You may also read `UI_SPEC_V2.md` for security-sensitive UI constraints.

---

# PRIMARY OBJECTIVE

Find and fix real security weaknesses before Finn begins storing sensitive slip/document data.

Focus especially on:

- authentication
- authorization
- RLS
- cross-user isolation
- secret keys
- environment variables
- demo mode
- server actions
- ownership validation
- input validation
- logging
- sensitive identifiers
- caching
- recovery/backup readiness

Do not perform security theater.

Verify implementation.

---

# RULE 1 — INSPECT BEFORE CHANGING

Before making changes:

1. inspect repository
2. inspect `package.json`
3. inspect `.gitignore`
4. inspect `.env.example`
5. inspect Supabase clients
6. inspect middleware/auth/session handling
7. inspect all migrations
8. inspect RLS policies
9. inspect server actions and route handlers
10. inspect demo mode
11. inspect validation schemas
12. inspect tests
13. search repository for secret-looking variables
14. search for `service_role`, `secret`, `SUPABASE`, `NEXT_PUBLIC`
15. search logging statements around finance/auth data

Do not assume existing security claims are correct.

---

# RULE 2 — DO NOT EXPOSE SECRETS

Verify that browser/client code contains only publishable/anon Supabase credentials.

Never expose:

- secret key
- service-role key
- DB password
- JWT signing secret

Forbidden examples:

```text
NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_SECRET_KEY
```

If discovered:

1. mark Critical
2. remove from client
3. move server-side only if genuinely required
4. state that the key must be rotated if it was ever exposed

Do not print actual secret values in your report.

---

# RULE 3 — RLS AUDIT

Audit all user-owned Phase 1 tables:

```text
profiles
accounts
transactions
categories
people
merchants
```

Verify RLS is enabled.

Verify appropriate:

- SELECT
- INSERT
- UPDATE
- DELETE

policies.

Look for dangerous policies such as:

```sql
USING (true)
```

or unrestricted authenticated access.

Test cross-user isolation rather than only reading migration text.

---

# RULE 4 — OWNERSHIP

Client-supplied `user_id` must never be trusted.

User identity must come from the authenticated session.

Audit mutations for:

- create account
- edit account
- create transaction
- edit transaction
- delete transaction
- create category
- people
- merchants
- demo data

---

# RULE 5 — FOREIGN KEY OWNERSHIP

This is mandatory.

Attempt attacks where User A supplies IDs belonging to User B:

- `from_account_id`
- `to_account_id`
- `category_id`
- `person_id`
- `merchant_id`

Every mutation must reject foreign resources.

Valid UUID != authorized resource.

Add automated tests.

---

# RULE 6 — DEMO MODE

Audit `Explore as Demo User` and sample-data tools.

Determine:

- how demo auth works
- whether it bypasses Supabase
- whether it can access real data
- whether it uses elevated credentials
- whether it is enabled in production

Preferred:

```text
demo tooling disabled or explicitly gated in production
```

If demo is public, it must be isolated and least-privileged.

Any production auth bypass is Critical.

---

# RULE 7 — INPUT VALIDATION

Audit all write boundaries.

Use existing Zod architecture or equivalent.

Validate:

- enums
- amount
- IDs
- dates
- text lengths
- account identifiers

Reject:

- NaN
- Infinity
- invalid amount
- invalid UUID
- unsupported transaction types
- same-account transfer

Do not use negative amount to express transaction direction.

---

# RULE 8 — MONEY SAFETY

Do not modify correct deterministic finance semantics.

Verify security hardening preserves:

- transfer isolation
- account reconciliation
- income/expense logic

No security fix may alter financial meaning accidentally.

---

# RULE 9 — SENSITIVE DATA MINIMIZATION

Verify current Account UI/storage does NOT require:

- bank password
- mobile banking PIN
- ATM PIN
- OTP
- CVV
- full credit card number

Prefer masked/last-4 identifiers.

If full account/card identifiers are unnecessarily stored, classify and remediate carefully without destructive migration unless approved.

---

# RULE 10 — ERROR & LOG AUDIT

Search for:

```text
console.log
console.error
JSON.stringify
raw Supabase error output
```

around sensitive flows.

Do not log:

- tokens
- passwords
- cookies
- service keys
- full finance records
- sensitive identifiers

User errors must not expose SQL or internal stack traces.

---

# RULE 11 — PROTECTED ROUTES

Test:

- direct dashboard access logged out
- expired session
- logout then browser back
- server-rendered dashboard request
- mutation logged out

Ensure sensitive financial content is never served to unauthenticated users.

---

# RULE 12 — SERVICE ROLE

Search every use of:

```text
service_role
secret key
admin Supabase client
```

Ordinary user CRUD should not need it.

If it is used only to bypass RLS, remove that pattern and fix RLS.

Document every remaining elevated access use.

---

# RULE 13 — REPOSITORY SECRET SCAN

Inspect source/config for accidentally committed secrets.

Do not display found secrets verbatim.

If historical Git scanning is available, inspect history too.

If a secret was committed:

```text
rotation is required
```

Removing it from the latest file is not sufficient.

---

# RULE 14 — GITIGNORE

Ensure local secret files are ignored.

Expected examples:

```text
.env
.env.local
.env.*.local
```

Do not ignore `.env.example`.

`.env.example` must contain placeholders only.

---

# RULE 15 — AUTHENTICATED CACHING

Inspect Next.js caching on pages that render user financial data.

Do not allow user-specific financial pages to become shared static/public cache entries.

Fix unsafe caching if found.

---

# RULE 16 — SECURITY HEADERS

Review security headers.

Consider:

- CSP
- frame-ancestors
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy

Do not add an untested CSP that breaks the app.

If not implemented, classify appropriately rather than pretending it is critical.

---

# RULE 17 — BACKUP PLAN

Do not build a large backup infrastructure in this pass unless simple and appropriate.

Create documentation for free-tier recovery.

At minimum document:

- weekly `supabase db dump` or equivalent logical export
- off-site protected storage
- restore-test recommendation
- backups contain sensitive data

If useful, add a script/document but do not commit actual dumps.

---

# RULE 18 — FUTURE PRIVATE STORAGE READINESS

Slip automation is not implemented yet.

Do NOT build OCR/upload now.

But confirm architecture documentation specifies:

```text
private buckets
user-scoped paths
RLS
signed URLs
file-size/MIME validation
```

Do not create public slip buckets.

---

# SECURITY FINDING FORMAT

Create:

```text
SECURITY_AUDIT_REPORT.md
```

For each finding:

```text
ID:
Severity:
Status:
Location:
Description:
Attack Scenario:
Existing Protection:
Fix:
Verification:
```

Severity:

```text
Critical
High
Medium
Low
Info
```

---

# REQUIRED ADVERSARIAL TESTS

Add automated tests for at least:

1. User A cannot read User B account
2. User A cannot read User B transaction
3. User A cannot update User B transaction
4. User A cannot delete User B transaction
5. User A cannot use User B source account
6. User A cannot use User B destination account
7. User A cannot use User B category
8. User A cannot use User B person
9. User A cannot use User B merchant
10. unauthenticated mutation rejected
11. invalid amount rejected
12. same-account transfer rejected
13. demo user cannot access another user's real records

Reuse existing test architecture.

---

# DO NOT DO

Do NOT:

- redesign UI
- replace Supabase
- replace auth provider
- rewrite finance engine
- implement Slip OCR
- implement Tax
- implement AI Assistant
- add banking credentials
- add payment processing
- use service role as an easy fix
- disable RLS to make tests pass
- delete failing security tests

---

# SECURITY GATE

The audit is considered ready for Phase 2 only when:

```text
0 unresolved Critical findings
0 unresolved High findings
```

Medium/Low findings may remain only if clearly documented with rationale and mitigation.

---

# RUN VERIFICATION

After fixes run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test
```

Also run any new security/integration tests separately if needed.

Do not claim success if build/tests fail.

---

# DELIVERABLE

At the end provide:

1. `SECURITY_AUDIT_REPORT.md`
2. files changed
3. RLS audit result by table
4. key/secret exposure audit result
5. demo mode audit result
6. server-action authorization audit
7. cross-user test results
8. logging/error audit
9. backup/recovery recommendation
10. unresolved findings
11. Phase 2 security gate result:

```text
READY FOR PHASE 2
```

or:

```text
NOT READY FOR PHASE 2
```

with reasons.

---

# FINAL RULE

Do not trust claims.

Verify controls.

For every important security claim, answer:

```text
Where is it enforced?
How was it tested?
What happens if the client is malicious?
```

Finn should remain secure even when the browser cannot be trusted.
