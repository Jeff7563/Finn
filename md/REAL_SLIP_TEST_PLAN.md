# REAL_SLIP_TEST_PLAN.md
# Finn — Real Slip Testing Plan

> Stage: Phase 2 Verification
> Status: Ready for manual testing
> Primary device: iPhone 11 Pro Max
> Goal: Validate real-world slip ingestion safely before normal daily use

---

## 1. Test Philosophy

Do not begin by feeding many real slips.

Start with controlled cases and verify every result.

Order:

```text
Synthetic / anonymized
↓
Real outgoing expense
↓
Internal transfer
↓
Incoming external payment
↓
Duplicate
↓
Bad / blurred slip
↓
Multiple banks
```

A wrong automatic transaction is worse than a review request.

---

## 2. Pre-Test Checklist

Before using a real slip:

```text
[ ] Production/test deployment uses HTTPS
[ ] `slips` bucket is PRIVATE
[ ] Storage RLS is enabled
[ ] No public slip URL works
[ ] Ingest token created for iPhone
[ ] Token can be revoked
[ ] Provider/API keys are server-only
[ ] Demo mode is not being used for real personal data
[ ] Database migration Phase 2 has been applied
[ ] Backup plan exists
```

---

## 3. Test Device Token

Create one token specifically for this device.

Label:

```text
iPhone 11 Pro Max
```

Do not reuse a developer/admin secret.

Verify Finn Settings shows:

```text
token prefix
created time
last-used time
revoke action
```

---

## 4. Test 0 — Synthetic / Anonymized Slip

Purpose:

Verify plumbing before real personal financial data.

Expected:

```text
Share image
↓
Finn accepts upload
↓
Processing starts
↓
Created / Needs Review / Failed safely
```

Verify:

```text
[ ] image stored privately
[ ] no public URL
[ ] Review UI loads
[ ] Light/Dark works
[ ] no console/server log contains full OCR or raw token
```

---

## 5. Test 1 — Real Outgoing Expense

Use one small real purchase/transfer to a merchant/person.

Expected extraction:

```text
amount
date/time
your source account
receiver
bank
reference
```

Expected classification:

```text
outgoing
```

Possible result:

```text
expense candidate
```

Verify:

```text
[ ] amount exact
[ ] date/time correct
[ ] correct source account
[ ] correct receiver
[ ] no duplicate warning unless appropriate
[ ] transaction created only once
[ ] Today updates
[ ] Overview updates
[ ] Calendar updates
```

If category is uncertain, uncategorized is acceptable.

---

## 6. Test 2 — Internal Transfer

Transfer between two Finn-owned accounts.

Expected:

```text
internal_transfer
```

Transaction:

```text
type = transfer
```

Critical verification:

```text
[ ] source account decreases
[ ] destination account increases
[ ] income total unchanged
[ ] expense total unchanged
[ ] net cash flow unchanged
[ ] Calendar shows transfer activity separately
```

FAIL the test immediately if transfer appears as income or expense.

---

## 7. Test 3 — External Incoming Money

Receive money from another person/account.

Expected:

```text
incoming
```

Critical behavior:

```text
MUST go to Review unless a user-approved rule exists
```

Verify:

```text
[ ] Finn does NOT silently mark it as confirmed income
[ ] Review Inbox shows the item
[ ] user can choose correct type
[ ] user can set person/source/category
[ ] confirming creates one transaction only
```

This validates:

> Money In != Income

---

## 8. Test 4 — Duplicate Exact File

Upload the exact same slip again.

Expected:

```text
duplicate
```

Verify:

```text
[ ] second transaction is NOT created
[ ] UI says slip was already recorded
[ ] original transaction remains unchanged
```

---

## 9. Test 5 — Duplicate Screenshot / Re-encoded Image

Take a screenshot of the same slip or re-save it.

Exact hash may differ.

Expected:

```text
reference duplicate
or
potential duplicate
```

Verify:

```text
[ ] no silent duplicate transaction
[ ] strong reference match blocks duplicate
[ ] fuzzy match goes to Review if uncertain
```

---

## 10. Test 6 — Blurred / Cropped Image

Use an intentionally poor image.

Expected:

```text
needs_review
or
failed
```

Finn must NOT guess a confident transaction.

Verify:

```text
[ ] no incorrect auto-create
[ ] safe user-facing error
[ ] manual correction available
```

---

## 11. Test 7 — Wrong / Unknown Account

Use a slip where Finn cannot confidently identify your account.

Expected:

```text
needs_review
```

Verify:

```text
[ ] account is not guessed solely by bank name
[ ] user must select/confirm account
```

---

## 12. Test 8 — Multiple Accounts at Same Bank

Add two accounts from the same bank.

Example:

```text
SCB ••1234
SCB ••5678
```

Use slip belonging to one.

Verify:

```text
[ ] correct one matched using masked/trailing digits
[ ] system does NOT match only "SCB"
[ ] ambiguous case goes to Review
```

---

## 13. Test 9 — QR Missing

Use a valid slip image where QR is missing/cropped.

Expected:

```text
OCR/Vision fallback
```

Verify:

```text
[ ] QR failure does not crash processor
[ ] OCR path can still extract usable information
[ ] confidence decreases appropriately
```

---

## 14. Test 10 — Provider Failure

Temporarily use invalid/missing OCR/Vision provider config in test environment.

Expected:

```text
safe failure / review
```

Verify:

```text
[ ] no fake extraction
[ ] no incorrect transaction
[ ] clear configuration-safe error
```

---

## 15. Test 11 — Revoked iPhone Token

Revoke the token in Finn.

Attempt Shortcut upload again.

Expected:

```text
401/403
```

Shortcut message:

```text
Finn Token ใช้งานไม่ได้
กรุณาสร้าง Token ใหม่ในตั้งค่า
```

Verify:
- revocation works immediately
- no file is accepted

---

## 16. Test 12 — Multiple Slips

Share 2–5 slips in one run.

Verify:

```text
[ ] each file processed independently
[ ] no accidental cross-linking
[ ] duplicates still detected
[ ] rate limit not triggered during normal use
```

---

## 17. Bank Coverage Matrix

Track results.

| Bank / Source | QR | Amount | Date | Account | Counterparty | Reference | Result |
|---|---|---|---|---|---|---|---|
| SCB |  |  |  |  |  |  |  |
| KBANK |  |  |  |  |  |  |  |
| KTB |  |  |  |  |  |  |  |
| BBL |  |  |  |  |  |  |  |
| TTB |  |  |  |  |  |  |  |
| BAY |  |  |  |  |  |  |  |
| PromptPay |  |  |  |  |  |  |  |

Do not require every bank to be perfect before initial personal use.

Prioritize the banks the user actually uses.

---

## 18. Accuracy Log

For every real test, record:

```text
Bank
Direction
Expected amount
Extracted amount
Expected account
Matched account
Expected date
Extracted date
Expected counterparty
Extracted counterparty
Reference correct?
Auto-created?
Review?
Duplicate?
Corrections needed?
```

Do not store real raw credentials in this log.

---

## 19. Acceptance Threshold

Before normal daily use, achieve:

```text
Amount accuracy            100% for tested slips
Transfer classification    100%
Exact duplicate prevention 100%
Incoming review guard      100%
Cross-user/private storage 100%
```

Counterparty/category accuracy may be lower initially because Review can correct it.

---

## 20. Stop Conditions

Stop real testing if any of these occur:

```text
- slip publicly accessible
- wrong amount auto-created
- duplicate transaction created
- internal transfer counted as income/expense
- external incoming auto-confirmed incorrectly
- revoked token still works
- another user's slip can be accessed
- secret/service key appears client-side
```

Fix before continuing.

---

## 21. Real-Use Readiness

Mark:

```text
REAL SLIP TESTING PASSED
```

only after:

- outgoing tested
- transfer tested
- incoming review tested
- duplicate tested
- token revoke tested
- private preview verified
- at least the user's primary bank works

---

## 22. Final Rule

For early real use:

> Prefer Review over incorrect automation.

Accuracy comes before automation percentage.
