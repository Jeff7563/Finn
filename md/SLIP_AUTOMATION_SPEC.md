# SLIP_AUTOMATION_SPEC.md
# Finn — Phase 2 Slip Automation

> Scope: Phase 2 only. Preserve Phase 1 finance logic, UI layout, themes, calendar, auth, RLS, and security hardening.
> Primary device: iPhone 11 Pro Max
> Country/currency: Thailand / THB

## 1. Goal

Turn a bank/payment slip into a structured Finn transaction with minimal typing:

```text
Share/upload slip
→ authenticate
→ private upload
→ QR decode
→ OCR/Vision extraction
→ deterministic validation
→ account/counterparty matching
→ duplicate detection
→ classification + confidence
→ auto-create OR Review Inbox
→ transaction
```

Automation must favor correctness over aggressive auto-import.

## 2. Core Rules

- `transactions` remains the only financial source of truth.
- AI may extract/normalize/suggest, but never calculate balances, cash flow, transfer isolation, or tax.
- Incoming money is **not automatically confirmed income**.
- Internal transfers must never count as income/expense.
- Slip files are sensitive and must always be private.
- No bank password, PIN, OTP, CVV, or banking credentials are collected.

## 3. Scope

Implement:

- private slip storage
- manual web upload
- iOS Shortcut ingest endpoint
- scoped/revocable ingest token
- QR decoding
- OCR/Vision provider abstraction
- structured slip extraction
- bank normalization
- own-account matching
- direction detection
- transaction type suggestion
- person/merchant matching
- category suggestion
- exact/reference/fuzzy duplicate detection
- confidence engine
- Review Inbox
- confirm/edit/reject/duplicate flow
- transaction ↔ slip linking
- signed private preview URLs
- responsive Light/Dark UI
- security and regression tests

Not in this phase:

- direct bank APIs
- notification scraping
- payment execution
- Tax Engine
- AI financial assistant
- native iOS app

## 4. Authentication Modes

### A. Web/PWA
Use the existing authenticated Finn session.

### B. iOS Shortcut
Use a dedicated scoped token:

```text
scope = slip:ingest
```

The token must be:

- high entropy
- stored hashed server-side
- shown raw only once
- revocable
- optionally expiring
- unable to read financial history
- unrelated to Supabase service-role keys

Suggested raw token format:

```text
finn_ingest_<random-secret>
```

Never send it in a URL query string.

## 5. Ingest Token Table

Recommended:

```text
ingest_tokens
├── id
├── user_id
├── token_hash
├── token_prefix
├── label
├── scope
├── created_at
├── last_used_at
├── expires_at nullable
├── revoked_at nullable
└── metadata jsonb
```

RLS required. Store hash only, never raw token.

## 6. Settings UI

Add:

```text
Automation / iPhone Shortcut

iPhone 11 Pro Max
สถานะ: เชื่อมต่อแล้ว
ใช้ล่าสุด: วันนี้ 18:42

[สร้าง Token] [ยกเลิก Token]
```

After creation, show token once with warning not to share an already-configured Shortcut.

## 7. Ingest API

Endpoint:

```text
POST /api/ingest/slip
```

Auth:

- Finn session OR
- `Authorization: Bearer <ingest-token>`

Content type:

```text
multipart/form-data
```

Fields:

```text
file            required
source          web_upload | ios_shortcut
client_id       optional
idempotency_key optional
```

Never trust a client-provided `user_id`.

## 8. Response Contract

Statuses:

```text
created
needs_review
duplicate
processing
failed
```

Example:

```json
{
  "jobId": "uuid",
  "status": "needs_review",
  "amount": 189,
  "currency": "THB",
  "reviewUrl": "/review/uuid"
}
```

Do not return raw OCR/provider data to iOS Shortcut.

## 9. File Validation

Initial supported MIME types:

```text
image/jpeg
image/png
image/webp
```

HEIC may be supported only if server decoding is verified; otherwise the Shortcut converts HEIC to JPEG.

Validate:

- authentication
- file exists
- max size (recommended 10 MB)
- MIME allowlist
- real image decode
- sane dimensions

Do not trust MIME declared by the client alone.

## 10. Private Storage

Bucket:

```text
slips
```

Must be **PRIVATE**.

Path:

```text
{user_id}/{yyyy}/{mm}/{uuid}.{ext}
```

Never put email, phone, amount, counterparty name, or full account number in object names.

## 11. Storage Access

Web access: owner-only via storage RLS.

Shortcut upload: backend validates the ingest token first, then performs the controlled upload. Any elevated storage credential required for this server route must stay server-only and must not bypass application authorization.

Preview flow:

```text
authenticate user
→ verify slip owner
→ issue short-lived signed URL
```

Recommended signed URL lifetime: 5–15 minutes.

## 12. Slip Table

Recommended:

```text
slips
├── id
├── user_id
├── storage_path
├── file_hash_sha256
├── mime_type
├── file_size
├── source
├── parser_version
├── qr_payload nullable
├── extracted_json jsonb nullable
├── raw_ocr_text nullable
├── overall_confidence nullable
├── status
├── linked_transaction_id nullable
├── duplicate_of_slip_id nullable
├── created_at
├── processed_at nullable
└── deleted_at nullable
```

Status:

```text
uploaded
processing
needs_review
created
duplicate
failed
rejected
```

## 13. Processing Jobs

Recommended:

```text
slip_ingestion_jobs
├── id
├── user_id
├── slip_id
├── status
├── attempt_count
├── processor_version
├── error_code nullable
├── safe_error_message nullable
├── started_at nullable
├── finished_at nullable
└── created_at
```

The first implementation may process in the request if necessary, but route code must stay thin and call a dedicated processor so the system can move to a queue later.

## 14. Slip Domain Structure

Suggested:

```text
src/lib/slip/
├── processor.ts
├── types.ts
├── confidence.ts
├── duplicate.ts
├── account-match.ts
├── counterparty-match.ts
├── qr/
├── ocr/
├── ai/
└── parsers/
    ├── generic.ts
    ├── scb.ts
    └── kbank.ts
```

Do not build one giant route handler.

## 15. Processing Order

```text
1. Validate file
2. SHA-256 exact-file duplicate check
3. Save privately
4. Normalize image
5. QR decode
6. OCR/Vision extract
7. Schema validation
8. Bank normalization
9. Match user accounts
10. Match person/merchant
11. Detect existing transaction/slip duplicate
12. Determine direction
13. Suggest transaction type/category
14. Compute confidence
15. Auto-create OR Review
```

## 16. QR Stage

QR is attempted before AI.

Do not assume every QR:

- exists
- has the same format
- proves authenticity
- contains amount/date/name

When the payload is understood, treat it as strong evidence.

## 17. OCR / Vision Provider Boundary

Use provider interfaces, for example:

```ts
interface OcrProvider {
  extractText(image: Buffer): Promise<OcrResult>;
}

interface VisionSlipParser {
  parse(input: SlipVisionInput): Promise<SlipExtraction>;
}
```

Provider keys are server-only environment variables.

Do not deeply couple the finance/slip domain to one vendor.

If provider credentials are missing, fail safely; do not fabricate extraction data.

## 18. Canonical Extraction

```ts
type SlipExtraction = {
  amount?: number;
  currency?: "THB";
  transactionDate?: string;
  sender?: {
    name?: string;
    bank?: string;
    accountMasked?: string;
  };
  receiver?: {
    name?: string;
    bank?: string;
    accountMasked?: string;
  };
  reference?: string;
  channel?: string;
  qrPayload?: string;
  fieldConfidence: {
    amount?: number;
    transactionDate?: number;
    senderName?: number;
    senderBank?: number;
    senderAccount?: number;
    receiverName?: number;
    receiverBank?: number;
    receiverAccount?: number;
    reference?: number;
  };
};
```

All provider output is untrusted and must pass schema validation.

## 19. Bank Normalization

Maintain a deterministic alias map.

Examples:

```text
SCB / Siam Commercial Bank / ธนาคารไทยพาณิชย์ → SCB
KBank / KBANK / Kasikornbank / ธนาคารกสิกรไทย → KBANK
```

## 20. Own-Account Matching

Match using:

- normalized bank
- masked digits / last 4
- account aliases

Never match by bank alone when the user has more than one account at that bank.

Return:

```text
accountId + confidence
```

## 21. Direction

Determine separately from transaction type:

```text
outgoing
incoming
internal_transfer
unknown
```

Rules:

- sender is owned, receiver not owned → outgoing
- receiver is owned, sender not owned → incoming
- sender and receiver both owned → internal_transfer
- neither matches → unknown

## 22. Transaction Type Suggestion

```text
internal_transfer → transfer
outgoing          → expense candidate
incoming          → review by default
unknown           → review
```

Incoming external funds must not be auto-confirmed as income merely because money entered the account.

A future/user-approved rule may allow reliable recurring sources to auto-classify.

## 23. Counterparty Matching

Use:

- normalized name
- aliases
- previous user corrections
- exact/near normalized matches

Keep `people` and `merchants` separate.

AI may suggest kind, but uncertainty is reviewable.

## 24. Category Suggestion Priority

1. user-specific previous mapping
2. merchant/category hint
3. deterministic keyword rule
4. AI suggestion

A reliable transaction may still be created as uncategorized.

## 25. Duplicate Detection

### Exact file duplicate

```text
SHA-256(file bytes)
```

Same user + same active hash → duplicate.

### Strong reference duplicate

Same user + same trusted reference → duplicate.

### Fuzzy duplicate

Conservative evidence:

- same amount
- same direction
- same owned account
- same counterparty
- close time (e.g. ±5 min)

Fuzzy result normally becomes `needs_review`, not silent discard.

## 26. Idempotency

Support `Idempotency-Key` when provided.

Network retry must not create a second transaction.

Use idempotency + file hash + reference logic together.

## 27. Confidence Engine

Do not simply average all fields.

Critical evidence includes:

- amount confidence
- own-account confidence
- direction confidence
- transaction date
- QR/reference evidence
- duplicate risk

Suggested safe baseline for auto-create:

```text
amount >= 0.98
own account >= 0.95
direction >= 0.95
no duplicate risk
```

Use rule-based gating in addition to scores.

## 28. Auto-Create Rules

### Internal transfer
May auto-create when both owned accounts, amount, and date are strongly matched.

### Outgoing expense
May auto-create when sender account, amount, date, and direction are strong and no duplicate risk exists. Category may remain uncategorized.

### Incoming external
Default: `needs_review` unless a user-approved rule establishes what the incoming money represents.

### Unknown
Always review.

## 29. Review Inbox

Add:

```text
/review
/review/{jobId} optional
```

Do not add a permanent main-navigation item unless necessary.

Show a pending-review badge/banner from Today/Transactions/More when count > 0.

Example card:

```text
฿189.00
รายจ่ายที่คาดไว้

SCB ••1234 → ABC SHOP
14 ก.ย. 2569 · 13:42
ความมั่นใจ 82%

หมวดหมู่: อาหาร (แนะนำ)

[ดูสลิป]
[ยืนยัน] [แก้ไข]
```

## 30. Review Actions

Support:

```text
Confirm
Edit & Confirm
Reject
Mark Duplicate
```

Confirm:
- create transaction
- link slip
- mark job `created`

Reject:
- no transaction
- mark `rejected`

Deleting the slip must not silently delete an already-confirmed transaction.

## 31. Review Editing

Editable:

- type
- amount
- date/time
- account
- person/merchant
- category
- note

Never allow changing `user_id`.

## 32. Corrections

Recommended table:

```text
slip_corrections
├── id
├── user_id
├── slip_id
├── field_name
├── extracted_value jsonb
├── corrected_value jsonb
└── created_at
```

Use later for personalized matching; do not train an external model automatically in Phase 2.

## 33. Manual Upload UI

Add action:

```text
อัปโหลดสลิป
```

Entry points:

- global `+`
- Transactions
- Review Inbox

Flow:

```text
choose image
→ preview
→ upload
→ processing
→ created/review/duplicate
```

Must support Light/Dark and iPhone layout.

## 34. Processing UI

Useful states:

```text
กำลังอัปโหลด...
กำลังอ่านสลิป...
กำลังตรวจสอบรายการ...
```

If long-running:

```text
รับสลิปแล้ว คุณสามารถกลับมาดูได้ที่รายการรอตรวจสอบ
```

## 35. Transaction Detail Integration

If source is a slip:

```text
แหล่งที่มา
สลิปธนาคาร

[ดูสลิป]
```

Preview must use an authorized signed URL.

## 36. Raw OCR Retention

Recommended default:

> Do not permanently retain raw OCR text after successful normalized extraction.

Persist normalized structured extraction and audit metadata.

Never log raw OCR/provider payloads in production.

## 37. Provider Privacy

When an OCR/Vision provider is used, send only what is needed for that slip.

Do not send:

- unrelated financial history
- auth/session tokens
- bank credentials
- service-role key

Validate every returned field.

## 38. Retry

Retry only temporary errors such as:

```text
provider timeout
provider rate limit
network error
```

Recommended maximum: 2–3 attempts.

Persist attempt count.

## 39. Rate Limiting

Initial personal-use ingest baseline:

```text
~30 uploads/hour/token
```

Also limit token creation and repeated failed authentication.

Document deployment limitations if rate limiting is process-local rather than distributed.

## 40. Audit Events

Safe events:

```text
ingest_token_created
ingest_token_revoked
slip_uploaded
slip_processed
slip_needs_review
slip_duplicate
slip_confirmed
slip_rejected
```

Never log raw token, image bytes, full account numbers, or raw OCR.

## 41. RLS / Ownership

Enable RLS on:

```text
ingest_tokens
slips
slip_ingestion_jobs
slip_corrections
```

Before linking anything, verify all referenced resources belong to the same authenticated user.

UUID knowledge is never authorization.

## 42. Storage Security Tests

Required:

1. User A cannot list/view/delete User B's slip.
2. Public slip URL fails.
3. Signed preview requires owner authorization.
4. Signed URL expires.
5. Cross-user slip ↔ transaction linking fails.

## 43. Token Security Tests

Required:

1. invalid token rejected
2. revoked token rejected
3. expired token rejected
4. token cannot read transactions
5. token cannot call unrelated APIs
6. token uploads only for its owner
7. raw token not stored
8. raw token never returned after creation

## 44. Duplicate Tests

Test:

- same exact file twice
- same reference but re-encoded image
- same amount, different reference
- same amount/time, different counterparty
- same idempotency key retry

Only one transaction may result from one real-world transfer.

## 45. Parser Tests

Use synthetic/anonymized fixtures only.

Required scenarios:

- valid outgoing expense
- incoming external
- internal transfer
- missing QR
- unreadable image
- partial extraction
- unknown bank
- duplicate
- Bangkok timezone boundary

Never commit real personal slips to the repository.

## 46. E2E

### High-confidence upload

```text
login → upload → process → transaction created → visible in Today/Transactions
```

### Needs review

```text
upload ambiguous slip → pending badge → edit → confirm → transaction created
```

### Duplicate

```text
upload same slip twice → second duplicate → one transaction only
```

### Mobile

At iPhone 11 Pro Max size verify upload, preview, review, confirm, no horizontal overflow, and bottom-nav safe area.

## 47. Theme

All new UI must inherit Finn Theme V3:

```text
system / light / dark
```

Do not hardcode white-only pages.

## 48. Phase 2 Definition of Done

Phase 2 is complete when:

- private slip bucket works
- web upload works
- iOS ingest-token API works
- QR stage exists
- OCR/Vision provider boundary works
- structured extraction validates
- own-account matching works
- transfers remain isolated
- duplicates are prevented
- Review Inbox works
- safe high-confidence cases can auto-create
- ambiguous incoming money requires review
- signed private preview works
- Light/Dark works
- security tests pass
- Phase 1 regression tests pass
- Playwright passes

## 49. Real-Slip Security Gate

Do not use real personal slips until:

```text
private bucket confirmed
storage RLS confirmed
public access fails
ingest token hash/revoke works
provider keys server-only
cross-user tests pass
duplicate tests pass
incoming ambiguity goes to review
```

## 50. Final Rule

A wrong automatic transaction is worse than a quick review.

Optimize for:

```text
high-confidence automation
+ fast correction
+ zero duplicate financial entries
+ private document handling
```
