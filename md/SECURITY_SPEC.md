# SECURITY_SPEC.md
# Finn — Security Architecture & Hardening Specification

> Product: Finn — Personal Finance OS
> Scope: Phase 1 security hardening before Slip Automation
> Status: Ready for audit and implementation
> Important: Security changes must preserve finance correctness, existing UX, current routing, deterministic calculations, and current user data ownership.

---

# 1. Security Objective

Finn stores personal financial information.

The security goal is not to make unrealistic claims like "100% secure".

The goal is to reduce risk through:

- least privilege
- strong user isolation
- secure secret handling
- minimal sensitive-data collection
- private file access
- deterministic authorization
- safe logging
- input validation
- auditability
- recoverability
- secure defaults

---

# 2. Threat Model

Primary risks:

1. User A accesses User B's data.
2. Service role / secret key leaks into browser or repository.
3. Demo mode bypasses real authentication in production.
4. Client submits another user's `user_id` or foreign key.
5. RLS is missing on one or more tables.
6. Weak UPDATE/DELETE policies allow cross-user mutation.
7. Financial identifiers are stored unnecessarily in full.
8. Sensitive documents later become public.
9. Raw Supabase/Postgres errors leak implementation details.
10. Logs contain financial or authentication secrets.
11. Uploaded files are unvalidated.
12. Free-tier project has insufficient recovery strategy.
13. Session/auth edge cases expose protected routes.
14. CSRF-like or replay behavior affects privileged server actions.
15. Future Slip API tokens become long-lived unrestricted credentials.

---

# 3. Security Non-Goals

Finn must NOT become:

- internet banking
- a payment processor
- a card vault
- an OTP handler
- a bank credential manager

Do not collect or store:

- bank password
- internet banking username/password
- mobile banking PIN
- ATM PIN
- OTP
- CVV
- full payment card PAN
- authentication secrets from banking apps

---

# 4. Data Classification

## Class A — Highly Sensitive

Examples:
- Supabase secret/service keys
- session secrets
- future webhook/API secrets
- signed upload tokens
- backup encryption keys

Rules:
- server only
- never `NEXT_PUBLIC_*`
- never browser
- never source control
- never console logs
- rotate immediately if exposed

## Class B — Sensitive Financial Data

Examples:
- transactions
- balances
- account mappings
- counterparties
- tax data
- future slips
- future tax documents

Rules:
- authenticated access only
- strict RLS
- owner-scoped access
- private storage for files
- safe logs
- export/delete controls

## Class C — Limited Identifiers

Examples:
- account last 4 digits
- institution name
- user display name

Rules:
- collect minimum necessary
- mask where useful
- avoid full identifiers

## Class D — Public App Metadata

Examples:
- category labels
- static UI strings
- design tokens

May be public if not user-specific.

---

# 5. Authentication

Use Supabase Auth.

Requirements:

- protected routes require an authenticated session
- unauthenticated users cannot access dashboard routes
- server actions derive identity from authenticated session
- never trust `user_id` supplied by client
- sign-out invalidates app session correctly
- login/signup errors are human-readable and do not leak internals

---

# 6. Demo Mode

Demo mode is a high-priority audit item.

Requirements:

- must be clearly isolated from real user authentication
- must not grant elevated database access
- must not use secret/service credentials in browser
- must not bypass RLS for normal user data
- must not be available as an unrestricted production backdoor
- preferably disabled or environment-gated in production

Recommended:

```text
NODE_ENV !== "production"
```

or explicit:

```text
ENABLE_DEMO_MODE=true
```

If demo mode remains available publicly, it must use an isolated demo account with limited access and disposable data.

---

# 7. Supabase Key Handling

Browser may use only:

- Supabase publishable key
- legacy anon key if project still uses it

Never expose:

- secret key
- service role key

Secret/service credentials bypass RLS and must remain server-side.

Requirements:

- inspect `.env*`
- inspect browser bundles where practical
- inspect `NEXT_PUBLIC_*` variables
- inspect source control
- inspect server/client Supabase factory code

If a secret has ever been committed or exposed, rotate it.

---

# 8. Environment Variables

Allowed browser variables may include:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

or legacy anon equivalent.

Forbidden:

```text
NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_SECRET_KEY
NEXT_PUBLIC_DATABASE_PASSWORD
```

Server-only secrets must not use `NEXT_PUBLIC_`.

`.env.local` must be ignored by Git.

Provide `.env.example` with placeholders only.

---

# 9. Row Level Security

RLS is mandatory on every user-owned table.

Audit at least:

```text
profiles
accounts
transactions
categories
people
merchants
```

Future tables must follow the same standard.

Policies must cover:

- SELECT
- INSERT
- UPDATE
- DELETE

Ownership must be based on authenticated user identity.

---

# 10. RLS Policy Principle

Use least privilege.

Conceptually:

```sql
auth.uid() = user_id
```

But policy correctness must be evaluated for each table and relation.

Do not use permissive policies like:

```sql
using (true)
```

for user financial tables.

---

# 11. INSERT Protection

A malicious client must not be able to create records for another user.

Preferred patterns:

- derive user id server-side
- or enforce RLS `WITH CHECK (auth.uid() = user_id)`
- ideally both

Never rely only on a hidden input field.

---

# 12. UPDATE / DELETE Protection

UPDATE and DELETE must ensure:

```text
record owner == authenticated user
```

Audit both:

- `USING`
- `WITH CHECK`

when relevant.

Prevent changing `user_id` ownership after creation.

---

# 13. Foreign-Key Ownership Validation

A user must not be able to reference another user's:

- account
- category
- person
- merchant

Example malicious request:

```text
Create my transaction
but set from_account_id to another user's account
```

Server-side validation must reject this even if IDs are valid UUIDs.

This is mandatory.

---

# 14. Server Actions / Route Handlers

Every mutating server action must:

1. authenticate user
2. validate input
3. validate referenced resources belong to user
4. execute mutation
5. return safe error response

Never trust client-supplied ownership metadata.

---

# 15. Input Validation

Use Zod or equivalent on all write boundaries.

Validate:

- transaction type
- amount
- account IDs
- category IDs
- dates
- notes
- names
- account type
- masked identifier
- search/filter params

Reject invalid enum values.

---

# 16. Money Validation

Financial amounts:

- must be positive where appropriate
- use decimal-safe handling
- no NaN
- no Infinity
- no negative amount used to invert transaction semantics
- maximum sensible bounds should be considered

Transaction type determines direction, not negative raw input.

---

# 17. Account Identifiers

Phase 1 must not require full account number.

Preferred:

```text
masked_number
last_four
```

Display:

```text
SCB ••1234
```

Avoid full account identifiers unless future legal/technical requirements justify them.

---

# 18. Credit Card Safety

For Phase 1, store only:

- label
- issuer
- type
- optional last 4 digits
- balance / credit metadata if required

Do not store:

- full PAN
- CVV
- PIN
- OTP

If Finn ever processes real card data in future, that is a separate security/compliance project.

---

# 19. Client Data Exposure

Audit browser-rendered payloads.

Do not send unnecessary fields to client.

Example:

If UI needs:

```text
SCB ••1234
```

do not return a full identifier and mask it only in JSX.

Minimize data before it reaches browser when possible.

---

# 20. URL Safety

Do not place sensitive financial data in URLs.

Allowed:

```text
?date=2026-09-14
?type=expense
```

Avoid:

```text
?accountNumber=...
?token=...
?balance=...
```

URLs may appear in browser history, analytics, screenshots, proxies, and logs.

---

# 21. Logging

Production logs must not include:

- passwords
- auth tokens
- session cookies
- Supabase secret keys
- full financial documents
- full account identifiers
- raw upload payloads
- OCR content from sensitive slips by default

Use structured safe logs.

Example:

```text
transaction_created
user_hash
transaction_id
type
```

not full record dump.

---

# 22. Error Handling

Users should see safe messages.

Example:

```text
บันทึกรายการไม่สำเร็จ
กรุณาลองอีกครั้ง
```

Server logs may include technical context, but must still avoid secrets.

Do not expose:

- SQL statements
- stack traces
- database host
- RLS internals
- service keys

---

# 23. Protected Route Behavior

Audit:

- direct navigation to dashboard while logged out
- expired session
- sign-out then browser Back
- multiple tabs
- server-rendered protected page
- client hydration behavior

Sensitive content must not render before redirect.

---

# 24. Session Handling

Use Supabase-supported SSR/session pattern for the current Next.js version.

Do not manually persist raw auth tokens in unsafe local storage unless the official client architecture requires it.

Avoid custom session code where official SSR helpers already solve the problem.

---

# 25. CSRF / Mutation Safety

For server actions and same-origin mutations:

- preserve framework-native protections
- avoid exposing privileged mutation endpoints without auth
- do not allow GET requests to mutate data
- validate content type where appropriate

Future public webhook endpoints require dedicated authentication.

---

# 26. Rate Limiting

Phase 1 should define rate-limiting boundaries even if modest.

Higher priority endpoints:

- login attempts
- signup
- future slip ingestion
- future AI routes
- export
- destructive operations

For current personal use, basic controls may be sufficient, but architecture should not assume unlimited trusted requests.

---

# 27. Data Export

User should eventually be able to export their own data.

Security rules:

- export only authenticated user's records
- generated export must not be publicly accessible
- temporary files should expire
- logs must not include export content

Phase 1 may mark this as future-ready if not implemented.

---

# 28. Data Deletion

Deletion architecture must support:

- transaction deletion
- account archive/delete policy
- user-owned data deletion
- future document/slip deletion
- full account deletion workflow

Do not claim full deletion exists unless implemented.

---

# 29. Audit Logging

For important destructive/security-sensitive events, maintain auditability.

Candidate events:

```text
account_created
account_archived
transaction_deleted
profile_changed
export_requested
future_document_deleted
```

Do not log secrets or full sensitive payloads.

Audit logs themselves must be user-scoped or admin-protected.

---

# 30. Supabase Storage — Future Slip Readiness

Phase 2 will add slips/documents.

All financial-document buckets must be:

```text
PRIVATE
```

Never public.

Private buckets should enforce storage RLS.

---

# 31. Future Storage Path Design

Preferred:

```text
slips/{user_id}/{uuid}.{ext}
documents/{user_id}/{uuid}.{ext}
```

Ownership can then be checked against the first path segment.

Never use predictable filenames containing:

- full account number
- user email
- phone number
- transaction amount

---

# 32. Signed URLs

For future private document preview:

- generate time-limited signed URLs
- use short expiry where practical
- only after authorization

Example target:

```text
5–15 minutes
```

Do not persist signed URLs in the database as permanent document links.

---

# 33. File Upload Validation — Future Phase 2

Before accepting slips/documents:

- authentication required
- allow-list MIME types
- validate extension and MIME
- file-size limit
- randomized server path
- reject unsupported files
- image decode validation when practical

Never trust client-declared MIME type alone.

---

# 34. Image Metadata

Consider stripping unnecessary metadata from uploaded images if it is not needed.

Potentially sensitive metadata includes:

- GPS
- device information
- creation metadata

Do not strip metadata that is required for a verified business requirement.

---

# 35. OCR / AI Privacy — Future Phase 2+

Before sending a slip/document to any AI service:

- identify provider
- identify what data is transmitted
- minimize fields where possible
- do not send unrelated user history
- document retention assumptions
- allow disabling AI processing if product supports it

AI must not receive bank credentials because Finn never stores them.

---

# 36. Backup Strategy

The database plan does not determine access-control quality, but recovery differs by plan.

For free-tier operation:

- define regular logical exports
- keep off-site copy
- protect backup files
- test restore process periodically

Do not rely on "we can probably recover it".

Recommended initial cadence for personal use:

```text
weekly backup
```

Increase frequency as the app becomes important.

---

# 37. Backup Security

Backups contain sensitive financial data.

Requirements:

- not public
- stored in access-controlled location
- preferably encrypted at rest
- retention policy defined
- old backups removed intentionally

Never upload database dumps to a public repository.

---

# 38. Git / Repository Security

Audit repository for:

- `.env`
- `.env.local`
- service keys
- database passwords
- JWT secrets
- copied Supabase dashboard values
- test credentials

`.gitignore` must cover local secret files.

If a secret was committed, deleting the line is not enough; rotate the secret.

---

# 39. Dependency Security

During audit:

- inspect outdated/high-risk dependencies
- avoid unnecessary auth/security libraries
- prefer official Supabase and Next.js patterns
- run package audit as advisory, not blindly auto-fix major versions

Do not break the app with uncontrolled `npm audit fix --force`.

---

# 40. Security Headers

Review deployment headers where practical.

Candidates:

```text
Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
frame-ancestors via CSP
```

Do not add a restrictive CSP blindly if it breaks Next.js/Supabase.

Implement and test deliberately.

---

# 41. Clickjacking

Finn contains financial data.

Prefer blocking unauthorized framing.

Use:

```text
frame-ancestors 'none'
```

or an equivalent policy unless future embedding is intentional.

---

# 42. Browser Caching

Sensitive authenticated pages should not be intentionally cached as public shared content.

Review Next.js caching behavior for authenticated data.

Do not statically cache user-specific financial pages across users.

---

# 43. Server-Side Rendering Isolation

Any server-rendered user data must be fetched under that user's session.

Never use a global elevated Supabase client to render normal user pages.

Service-level access should be exceptional and justified.

---

# 44. Service Role Usage

Audit every usage of service/secret client.

Acceptable examples:

- trusted admin backend
- secure maintenance task
- future controlled backup job

Not acceptable:

- ordinary user CRUD
- browser client
- frontend component
- shortcut to avoid writing RLS

Goal:

```text
Normal Finn user flows should not need service-role access.
```

---

# 45. Search and Filters

All user-entered search/filter values must be treated as untrusted.

Use safe query APIs and validation.

Do not build raw SQL strings from client input.

---

# 46. IDs

UUIDs are not authorization.

Knowing another record's ID must never grant access.

Authorization must remain based on authenticated ownership and RLS.

---

# 47. Production Demo Tools

Current sample-data loader must be audited.

Preferred:

```text
hidden/disabled in production
```

If retained:

- user-scoped only
- cannot alter another user's data
- cannot call elevated service role from browser
- clearly marked as demo/development

---

# 48. Security UI

Settings may show:

```text
ความเป็นส่วนตัวและความปลอดภัย
```

But only claim verified controls.

Good:

```text
ข้อมูลของคุณถูกจำกัดการเข้าถึงตามบัญชีผู้ใช้
```

Bad:

```text
ปลอดภัย 100%
เข้ารหัสทุกอย่างแบบธนาคาร
```

unless technically verified and accurately scoped.

---

# 49. Security Audit Severity Levels

Classify findings:

## Critical
Examples:
- service role exposed client-side
- RLS disabled on finance table
- cross-user reads/writes possible
- production demo auth bypass

Fix before any real data.

## High
Examples:
- foreign-key ownership bypass
- private financial data publicly accessible
- destructive unauthenticated endpoint

Fix before Phase 2.

## Medium
Examples:
- verbose sensitive logs
- no rate limit on abuse-prone endpoint
- missing security headers

Fix or document before public deployment.

## Low
Examples:
- minor metadata exposure
- non-sensitive version leakage
- security copy issue

Track and improve.

---

# 50. Security Audit Deliverable

Agent must produce a report containing:

```text
Finding ID
Severity
File / location
Problem
Exploit scenario
Current protection
Required fix
Fix applied?
Verification
```

Example:

```text
SEC-003
High
src/app/actions/transactions.ts

Foreign account ID could be submitted.

Fix:
Validate account.user_id === authenticated user before insert.

Verification:
Integration test attempts cross-user account reference and receives rejection.
```

---

# 51. Required Adversarial Tests

Add/verify tests for:

1. User A cannot read User B account.
2. User A cannot read User B transaction.
3. User A cannot update User B transaction.
4. User A cannot delete User B transaction.
5. User A cannot attach User B account to own transaction.
6. User A cannot attach User B category.
7. User A cannot attach User B person.
8. User A cannot attach User B merchant.
9. Logged-out mutation fails.
10. Invalid amount rejected.
11. Same-account transfer rejected.
12. Demo user cannot access real user records.

---

# 52. Security Regression Rule

Security tests must remain part of automated test suite.

Do not perform security validation only manually.

---

# 53. Current Phase Boundaries

This security pass should harden Phase 1.

Do NOT yet implement:

- full Slip Storage
- OCR
- AI
- Tax documents
- Shortcut API
- bank APIs

But create safe foundations so Phase 2 can build on them.

---

# 54. Phase 2 Security Gate

Do not start Slip Automation until all Critical and High findings from the Phase 1 audit are resolved.

Required before real slip upload:

```text
RLS verified
secret handling verified
demo mode safe
private storage design ready
upload auth design ready
file validation design ready
backup plan defined
```

---

# 55. Free Tier Position

Using a free database tier is acceptable for development/personal early use if security controls are configured correctly.

Free tier is NOT permission to weaken:
- RLS
- auth
- storage privacy
- secret handling

The notable operational issue is recovery/backup capability, so Finn must define an off-site backup routine before important real data accumulates.

---

# 56. Final Security Principle

Finn should collect the least sensitive information necessary.

The safest credential is:

> the credential Finn never collects.

Security should be implemented in layers:

```text
Minimal data
+
Authentication
+
RLS
+
Server-side validation
+
Private storage
+
Safe secrets
+
Safe logging
+
Backups
+
Tests
```

No single layer should be treated as sufficient.
