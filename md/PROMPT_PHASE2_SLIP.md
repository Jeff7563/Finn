# PROMPT_PHASE2_SLIP.md
# Agent Prompt — Implement Finn Phase 2 Slip Automation

You are a senior full-stack engineer, application security engineer, and product engineer working on the existing Finn Personal Finance OS.

Phase 1 and its security gate are complete.

Read before editing:

- `PRODUCT_SPEC.md`
- `SECURITY_SPEC.md`
- `SECURITY_AUDIT_REPORT.md`
- `STORAGE_SECURITY_SPEC.md`
- `SLIP_AUTOMATION_SPEC.md`
- `IOS_SHORTCUT_SPEC.md`
- `UI_SPEC_V2.md`
- `UI_THEME_V3.md`

The primary source of truth for this phase is `SLIP_AUTOMATION_SPEC.md`, followed by `IOS_SHORTCUT_SPEC.md` and the existing security specifications.

---

## Primary Objective

Implement:

```text
Web/iPhone slip
→ secure ingest
→ private storage
→ QR/OCR/Vision extraction
→ structured parser
→ account matching
→ duplicate detection
→ confidence
→ auto-create OR Review Inbox
→ transaction
```

---

## Non-Negotiable

Do NOT:

- weaken RLS
- disable security triggers
- expose service-role keys
- put service keys into Shortcut
- use public slip storage
- log raw slip images, raw tokens, or raw OCR
- change finance semantics
- count transfers as income/expense
- auto-confirm ambiguous incoming money as income
- redesign the approved UI layout
- implement Tax
- implement AI Assistant
- implement direct bank integration

---

## Step 1 — Audit Existing Phase 1

Inspect:

1. `SECURITY_AUDIT_REPORT.md`
2. `STORAGE_SECURITY_SPEC.md`
3. migrations/RLS
4. auth/session code
5. server actions/data store
6. transaction/account schemas
7. UI Theme V3 tokens
8. current global Add menu
9. test architecture

Preserve secure Phase 1 behavior.

---

## Step 2 — New Tables

Add only the Phase 2 persistence needed, expected:

```text
ingest_tokens
slips
slip_ingestion_jobs
slip_corrections
```

Requirements:

- RLS
- ownership
- constraints
- indexes
- timestamps

Do NOT create a second financial source-of-truth table.

---

## Step 3 — Private Storage

Implement/configure private bucket:

```text
slips
```

Path:

```text
{user_id}/{yyyy}/{mm}/{uuid}.{ext}
```

Verify:

- public access fails
- owner-only access
- signed URL after authorization only
- cross-user storage tests

If bucket creation needs dashboard/manual setup, document exact steps and still provide policies/migrations where supported.

---

## Step 4 — Scoped Ingest Token

Implement iOS token system:

```text
scope = slip:ingest
```

Token must be:

- random high entropy
- stored hashed
- raw shown once
- user-scoped
- revocable
- optionally expiring
- last-used tracked

Never use a Supabase service-role key as the Shortcut token.

Add Settings UI for create/list/revoke.

---

## Step 5 — Ingest API

Implement:

```text
POST /api/ingest/slip
```

Supports:

- authenticated Finn session
- bearer ingest token

Input:

- multipart file
- source
- optional idempotency key

Validate auth, MIME, size, actual image decode, rate limit.

Never trust client `user_id`.

---

## Step 6 — Upload + Job

On accepted upload:

1. compute SHA-256
2. exact duplicate check
3. private storage upload
4. create `slips`
5. create processing job
6. call a dedicated `SlipProcessor`

Keep route code thin.

---

## Step 7 — Slip Domain Layer

Build modularly, e.g.:

```text
src/lib/slip/
  processor
  types
  confidence
  duplicate
  account-match
  counterparty-match
  qr
  ocr
  ai
  parsers
```

No giant route handler.

---

## Step 8 — QR First

Attempt QR decoding before OCR/Vision.

Do not assume QR always exists, always verifies authenticity, or always contains all fields.

Use understood QR payload as strong evidence.

---

## Step 9 — OCR / Vision Provider

Use provider interfaces and server-only credentials.

Implement at least one working configured provider path, or a complete provider adapter with safe configuration failure if credentials are not available during development.

Do not fabricate extraction results.

---

## Step 10 — Structured Extraction

Validate provider output into:

```text
amount
currency
transactionDate
sender.name
sender.bank
sender.accountMasked
receiver.name
receiver.bank
receiver.accountMasked
reference
channel
fieldConfidence
```

Provider JSON is untrusted input.

---

## Step 11 — Account Matching

Match using:

- bank
- masked digits / last 4
- aliases

Never match solely by bank when multiple accounts exist.

---

## Step 12 — Direction

Deterministically classify:

```text
outgoing
incoming
internal_transfer
unknown
```

Internal transfer remains excluded from income, expense, and net cash flow.

---

## Step 13 — Transaction Type

Rules:

```text
internal_transfer → transfer
outgoing          → expense candidate
incoming          → review unless approved rule exists
unknown           → review
```

Do not auto-confirm generic incoming funds as income.

---

## Step 14 — Duplicates

Implement:

1. exact file hash
2. strong reference duplicate
3. conservative fuzzy duplicate
4. idempotency-key support

Potential fuzzy duplicate → Review.

Network retry must not create another transaction.

---

## Step 15 — Confidence

Use rule-based critical-field gating, not a simple average.

Auto-create requires reliable:

- amount
- owned account
- direction
- date
- duplicate safety

Internal transfer/outgoing may auto-create when safe.

Ambiguous incoming → Review.

---

## Step 16 — Review Inbox

Implement:

```text
/review
```

Support:

- pending list
- private slip preview
- extracted values
- confidence
- duplicate warning
- Confirm
- Edit & Confirm
- Reject
- Mark Duplicate

Add a pending-review badge/banner to existing UI without redesigning navigation.

---

## Step 17 — Manual Upload

Add:

```text
อัปโหลดสลิป
```

into the existing Add/Transactions flow.

Flow:

```text
choose → preview → upload → processing → result
```

Must support current Light/Dark themes.

---

## Step 18 — Transaction Detail

Slip-derived transactions should show:

```text
แหล่งที่มา: สลิปธนาคาร
[ดูสลิป]
```

Use authorized short-lived signed preview URL.

---

## Step 19 — iOS Setup UI / Docs

Implement Settings instructions from `IOS_SHORTCUT_SPEC.md`.

At minimum:

- create/revoke token
- endpoint URL
- exact Shortcut setup steps
- security warning

Never embed a real token in source.

---

## Step 20 — Privacy

Default:

- do not permanently retain raw OCR after normalized extraction unless required
- no raw provider payload logs
- no image-byte logs
- no raw token logs

---

## Step 21 — Rate Limiting

Apply to:

- ingest endpoint
- token creation
- failed auth/retries

A personal-use baseline around 30 uploads/hour/token is acceptable; document any deployment-specific limitations.

---

## Step 22 — Tests

### Unit

Test:

- token hash/verify/revoke
- file validation
- exact/reference/fuzzy duplicate
- account matching
- direction
- transfer isolation
- confidence gating
- incoming requires review
- timezone
- extraction schema validation

Use synthetic/anonymized fixtures only.

### Security

Test:

1. User A cannot access User B slip
2. User A cannot access User B job/token metadata
3. invalid/revoked/expired token rejected
4. ingest token cannot read transactions or unrelated APIs
5. signed preview requires owner
6. public slip access fails
7. service role absent from browser
8. raw ingest token is not stored
9. cross-user transaction linking fails

### E2E

High confidence:

```text
login → upload synthetic slip → created → visible in Today/Transactions
```

Review:

```text
upload ambiguous slip → Review → edit → confirm
```

Duplicate:

```text
same slip twice → only one transaction
```

Mobile iPhone 11 Pro Max:

- upload
- review
- preview
- confirm
- no horizontal overflow

---

## Step 23 — iOS Contract

Verify API contract exactly:

```text
POST /api/ingest/slip
Authorization: Bearer finn_ingest_...
multipart file
source=ios_shortcut
```

Return statuses required by `IOS_SHORTCUT_SPEC.md`.

Create a manual iPhone verification guide.

---

## Step 24 — Regression

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test
```

All existing Phase 1 security/finance/theme/calendar tests must remain green.

Do not remove tests to pass.

---

## Step 25 — Report

Create:

```text
PHASE2_SLIP_IMPLEMENTATION_REPORT.md
```

Include:

1. files changed
2. migrations
3. storage policies
4. token architecture
5. ingest API contract
6. parser/provider architecture
7. duplicate strategy
8. confidence strategy
9. review flow
10. privacy behavior
11. security test results
12. unit/E2E results
13. iPhone setup status
14. unresolved findings

Final status must be one of:

```text
READY FOR REAL SLIP TESTING
```

or

```text
NOT READY FOR REAL SLIP TESTING
```

Do not mark ready unless:

- 0 unresolved Critical/High security findings
- private bucket verified
- storage cross-user tests pass
- token revoke works
- duplicates prevented
- ambiguous incoming goes to review
- Phase 1 regression tests pass

---

## Final Rule

Do not maximize automation percentage.

Maximize trustworthy automation.

When uncertain, Review is the correct behavior.
