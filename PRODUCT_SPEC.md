# PRODUCT_SPEC.md
# Personal Finance OS — รายรับรายจ่ายอัตโนมัติ + Slip Intelligence + Tax Assistant

> Status: Product Specification v1.0  
> Platform: Web App / PWA first, iPhone-friendly  
> Primary user: Individual user in Thailand  
> This is a standalone project and is completely separate from the Weight Loss App.

---

## 1. Product Vision

สร้างเว็บแอปการเงินส่วนบุคคลแบบครบวงจรที่ไม่ใช่เพียง “สมุดรายรับรายจ่าย” แต่เป็นระบบที่ช่วยผู้ใช้เข้าใจเงินของตัวเองแบบอัตโนมัติ

เป้าหมายหลักคือ:

> “ทุกครั้งที่มีเงินเข้า หรือเงินออก ระบบควรบันทึก วิเคราะห์ จัดหมวด และอัปเดตภาพรวมทางการเงินให้โดยใช้แรงจากผู้ใช้น้อยที่สุด”

แอปต้องสามารถ:

- บันทึกรายรับ
- บันทึกรายจ่าย
- บันทึกเงินโอนระหว่างบัญชี
- บันทึกว่าโอนให้ใคร / รับจากใคร
- รับสลิปการโอนเงินจาก iPhone
- อ่านข้อมูลสลิปอัตโนมัติ
- ตรวจจับยอดเงิน วันที่ ธนาคาร ผู้ส่ง ผู้รับ และเลขอ้างอิง
- จัดหมวดหมู่อัตโนมัติ
- ตรวจรายการซ้ำ
- สรุปรายเดือน / รายปี
- คำนวณ Cash Flow
- คำนวณ Safe to Spend
- ประเมินภาษีบุคคลธรรมดา
- เก็บข้อมูลค่าลดหย่อน
- เก็บภาษีหัก ณ ที่จ่าย
- ประเมินภาษีที่อาจต้องจ่าย
- แนะนำว่าผู้ใช้อาจมีสิทธิลดหย่อนอะไรเพิ่มเติม
- มี AI Assistant สำหรับถามข้อมูลการเงินจากข้อมูลจริงของผู้ใช้

---

# 2. Product Principles

## 2.1 Automation First

ผู้ใช้ไม่ควรต้องกรอกรายการด้วยมือถ้าไม่จำเป็น

ลำดับความสำคัญ:

1. Auto Import
2. Slip Share
3. OCR / QR extraction
4. AI classification
5. Quick confirmation
6. Manual entry เป็น fallback

---

## 2.2 Finance Data Must Be Deterministic

AI สามารถช่วย:

- อ่านสลิป
- จัดหมวด
- เดาคู่รายการ
- เข้าใจชื่อบุคคล / ร้านค้า
- อธิบายผล

แต่ AI ห้ามเป็นผู้คำนวณตัวเลขหลัก เช่น:

- ยอดรวม
- Balance
- Cash Flow
- Tax
- Budget
- Withholding tax
- Safe to Spend

ตัวเลขทั้งหมดต้องมาจาก:

> Database → Calculation Engine → Result → AI Explanation

---

## 2.3 Money In Is Not Always Income

เงินเข้าต้องไม่ถูกนับเป็นรายได้โดยอัตโนมัติ

Transaction Type ต้องรองรับอย่างน้อย:

- income
- expense
- transfer
- refund
- reimbursement
- loan_received
- loan_payment
- gift
- adjustment

---

## 2.4 Tax Rules Must Be Versioned

ห้าม hard-code กฎหมายภาษีไว้กระจายอยู่ใน UI

ต้องมี Tax Rule Engine แยกตาม:

- country
- tax_year
- income_type
- deduction type
- tax bracket
- expense deduction rule
- tax credit rule

ตัวอย่าง:

```text
Tax Rules
└── TH
    ├── 2026
    ├── 2027
    └── 2028
```

---

# 3. Target Platform

## Phase 1

- Web App
- Responsive
- Mobile-first
- PWA
- Safari on iPhone supported
- Desktop supported

## Primary Device

- iPhone 11 Pro Max
- Safari
- iOS Share / Shortcut workflow

---

# 4. Suggested Tech Stack

## Frontend

- Next.js 16+
- TypeScript
- Tailwind CSS
- React Server Components where appropriate
- PWA support

## Backend

Preferred:

- Next.js API Routes / Route Handlers

or:

- Supabase Edge Functions

## Database

- PostgreSQL
- Supabase recommended

## Authentication

- Supabase Auth

## File Storage

- Supabase Storage

Use for:

- slips
- receipts
- tax documents
- withholding documents
- invoices

## AI / Vision

Use AI only for:

- OCR fallback
- slip understanding
- merchant classification
- person / merchant normalization
- category suggestion
- explanation
- assistant

## Other Processing

- QR decoder
- OCR engine
- image preprocessing
- duplicate detection

---

# 5. Core Navigation

Main navigation:

```text
Today
Overview
Transactions
People
Accounts
Budgets
Tax
Documents
Insights
Assistant
Settings
```

Mobile bottom navigation can prioritize:

```text
Today
Transactions
+
Tax
More
```

---

# 6. Page Specifications

# 6.1 Today

Purpose:

หน้าที่ผู้ใช้เปิดบ่อยที่สุด

แสดงสถานะการเงินที่ “ต้องรู้วันนี้”

Sections:

## Header

- greeting
- current date
- profile avatar

## Primary Balance

```text
Total Balance
฿28,450
```

Sub-data:

- change from last month
- available cash

## Safe to Spend

```text
Safe to Spend
฿8,230
```

Formula concept:

```text
Current available money
- upcoming recurring expenses
- reserved savings
- budget obligations
- tax reserve
= Safe to Spend
```

## Month Summary

```text
Income
฿17,600

Expense
฿8,420

Net Cash Flow
+฿9,180
```

## Tax Reserve

```text
Estimated Tax Reserve
฿0
```

or

```text
Estimated Tax Reserve
฿1,250
```

## Recent Transactions

Show latest 5–10 entries.

Example:

```text
Lotus's          -฿389
Salary          +฿4,800
7-Eleven          -฿82
Somchai          -฿500
```

## Quick Actions

- Add Income
- Add Expense
- Scan Slip
- Upload Document
- Transfer

---

# 6.2 Overview

Purpose:

Financial dashboard

Sections:

- Total balance
- Income this month
- Expenses this month
- Net cash flow
- Savings rate
- Spending by category
- Monthly trend
- Account balances
- Top merchants
- Top people
- Tax forecast
- Budget status

Time filters:

- This month
- Last month
- 3 months
- 6 months
- This year
- Custom

---

# 6.3 Transactions

Main transaction ledger.

Columns / cards:

- date
- type
- title
- counterparty
- category
- account
- amount
- tax status
- source
- confidence status

Filters:

- income
- expense
- transfer
- refund
- person
- merchant
- category
- account
- amount
- date range
- taxable
- deductible
- source
- auto/manual

Search must support:

- person
- shop
- note
- reference number
- amount

---

# 6.4 Transaction Detail

Each transaction should show:

```text
฿350.00

Expense

To
Somchai

Category
Food

Account
SCB ••1234

Date
14 Sep 2026 13:34

Payment Method
PromptPay

Tax Status
Personal expense
Not deductible

Source
Bank Slip

Confidence
97%

Slip
[View]
```

Actions:

- Edit
- Change category
- Change type
- Merge duplicate
- Link person
- Link merchant
- Mark taxable
- Mark deductible
- Add note
- Delete

---

# 6.5 People

Purpose:

ดูว่าเรา “รับเงินจากใคร / จ่ายให้ใคร” มากที่สุด

Each person:

```text
Somchai

Received
฿500

Paid
฿2,500

Net
-฿2,000
```

Person detail:

- lifetime received
- lifetime paid
- net
- transaction count
- first transaction
- last transaction
- recent activity
- categories
- notes

---

# 6.6 Merchant

Merchant and Person should be separated internally.

Example merchants:

- 7-Eleven
- Lotus's
- Grab
- Shopee
- Lazada

Merchant details:

- total spent
- transaction count
- average transaction
- category
- monthly trend

---

# 6.7 Accounts

Supported account types:

- bank
- cash
- e-wallet
- credit card
- investment
- other

Fields:

- account name
- bank name
- type
- last 4 digits
- balance
- currency
- active
- hidden

Examples:

```text
SCB ••1234
฿12,500

KBank ••5678
฿8,350

Cash
฿1,200
```

Transfers between own accounts must not count as income/expense.

---

# 6.8 Budgets

Budget types:

- monthly overall
- category
- merchant
- custom

Example:

```text
Food
Budget: ฿4,000
Used: ฿2,850
Remaining: ฿1,150
```

Status:

- safe
- warning
- exceeded

---

# 6.9 Tax Center

Purpose:

ให้ผู้ใช้เห็นสถานการณ์ภาษีปัจจุบันและการคาดการณ์

Main sections:

## Tax Year

Selector:

- 2026
- 2027
- etc.

## Total Recorded Income

Breakdown:

```text
Salary
Freelance
Affiliate
Business
Other
```

## Taxable Income

Must be calculated by deterministic Tax Engine.

## Expense Deductions

Display rule-based deductions.

## Personal Deductions

Display:

- already used
- available
- unknown / needs info

## Withholding Tax

Track:

- withheld amount
- payer
- document
- related income

## Estimated Tax

Show:

```text
Estimated annual tax
฿9,500

Withholding already paid
-฿4,800

Estimated remaining
฿4,700
```

## Monthly Tax Reserve

```text
Suggested reserve
฿783 / month
```

## Tax Alerts

Examples:

- income nearing a threshold
- missing tax classification
- missing withholding document
- possible deduction available
- tax year incomplete

Important:

Tax UI must display:

> “This is an estimate based on recorded data and configured tax rules. It is not a tax filing or professional tax advice.”

---

# 6.10 Tax Deductions

Each deduction:

- name
- tax year
- limit
- amount used
- remaining capacity
- required evidence
- status

Statuses:

- eligible
- possibly eligible
- not eligible
- needs information
- already maxed

Never let AI invent deduction limits.

Limits must come from `tax_rules`.

---

# 6.11 Documents

Supported document types:

- bank slip
- receipt
- tax invoice
- e-tax invoice
- invoice
- withholding certificate
- 50 bis
- payment receipt
- other

Each document:

- file
- type
- date
- issuer
- receiver
- amount
- tax amount
- extracted text
- linked transaction
- verification state

---

# 6.12 Insights

Examples:

```text
You spent 23% more on food this month.

Your top merchant is 7-Eleven.

Transport spending decreased by 18%.

Your average daily spending is ฿286.

You may exceed your food budget in 7 days.
```

No fabricated financial figures.

Every insight must be based on database calculations.

---

# 6.13 AI Assistant

Sample questions:

- เดือนนี้ผมใช้เงินไปเท่าไร
- ค่าอาหารเดือนนี้เทียบเดือนก่อนเป็นยังไง
- ผมโอนให้สมชายไปทั้งหมดเท่าไร
- เงินเข้าจากใครมากที่สุด
- ปีนี้รายได้เท่าไร
- ถ้ารายได้ยังเท่านี้สิ้นปีจะเป็นเท่าไร
- ต้องกันเงินเสียภาษีเท่าไร
- รายการไหนยังไม่ได้จัดประเภทภาษี
- เดือนนี้ใช้เงินเกินงบตรงไหน

Architecture:

```text
User Question
      ↓
Intent Parser
      ↓
Database Query / Finance Engine / Tax Engine
      ↓
Structured Result
      ↓
AI Explanation
```

AI must never calculate tax independently.

---

# 7. Slip Automation

# 7.1 iPhone Workflow

Because browser/PWA cannot freely read banking app notifications, the initial automated workflow should use iOS Share + Shortcuts.

Flow:

```text
Bank app
↓
Receive slip
↓
Share
↓
Shortcut: "บันทึกเงิน"
↓
POST slip to API
↓
QR + OCR + AI
↓
Transaction created
↓
Notification / result
```

Goal:

User action should ideally be:

> Share → บันทึกเงิน

No manual amount typing.

---

# 7.2 Slip Ingestion API

Endpoint concept:

```text
POST /api/ingest/slip
```

Input:

- image
- source
- uploaded_at
- account hint optional

Pipeline:

```text
1. Validate file
2. Hash image
3. Check duplicate file
4. Decode QR
5. OCR
6. Parse structured fields
7. AI fallback / normalization
8. Match account
9. Match person or merchant
10. Determine transaction type
11. Suggest category
12. Check transaction duplicate
13. Calculate confidence
14. Auto-save or request review
```

---

# 7.3 Slip Extraction Result

Canonical structure:

```json
{
  "transactionType": "expense",
  "amount": 189.00,
  "currency": "THB",
  "transactionDate": "2026-09-14T13:42:00+07:00",
  "sender": {
    "name": "Jirawat",
    "bank": "SCB",
    "accountMasked": "xxx-x-x123-x"
  },
  "receiver": {
    "name": "ABC SHOP",
    "bank": "KBANK",
    "accountMasked": "xxx-x-x456-x"
  },
  "reference": "ABC123456",
  "channel": "PromptPay",
  "confidence": 0.97
}
```

---

# 7.4 Confidence Rules

Suggested:

## >= 0.95

Auto-save

## 0.70 – 0.949

Save as pending review

## < 0.70

Require user confirmation

Confidence should consider:

- amount confidence
- date confidence
- sender match
- receiver match
- QR validation
- reference match
- duplicate risk

---

# 7.5 Duplicate Detection

Check:

- file hash
- reference number
- amount
- datetime
- sender
- receiver

Possible result:

```text
Potential duplicate detected
```

Never silently create obvious duplicates.

---

# 8. Auto Classification

System should classify:

- transaction type
- category
- merchant
- person
- tax classification

Examples:

```text
7-Eleven → Food / Convenience Store
PTT → Fuel
Grab → Transport / Food depending context
Shopee → Shopping
Salary payer → Salary
```

User corrections should train local preferences.

Example:

If user changes:

```text
7-Eleven
Food → Household
```

System can remember personalized mapping rules.

---

# 9. Categories

Default categories:

## Income

- Salary
- Freelance
- Business
- Affiliate
- Commission
- Refund
- Investment Income
- Gift
- Loan Received
- Other Income

## Expense

- Food
- Transport
- Fuel
- Rent
- Utilities
- Internet
- Phone
- Shopping
- Entertainment
- Education
- Health
- Pet
- Family
- Debt
- Subscription
- Investment
- Tax
- Donation
- Business Expense
- Other

Users can create custom categories.

---

# 10. Transaction Types

Recommended enum:

```text
income
expense
transfer
refund
reimbursement
loan_received
loan_payment
gift
investment
adjustment
```

Never infer taxable income solely from `transaction_type`.

Tax classification is separate.

---

# 11. Tax Classification

Use a separate field such as:

```text
tax_income_type
```

Possible values may include Thailand personal income tax classifications where applicable.

Example representation:

```text
TH_40_1
TH_40_2
TH_40_3
TH_40_4
TH_40_5
TH_40_6
TH_40_7
TH_40_8
NON_TAXABLE
UNKNOWN
```

Tax Engine must use versioned rules.

---

# 12. Safe to Spend Engine

Purpose:

ช่วยตอบ:

> “ตอนนี้ใช้เงินได้จริงเท่าไรโดยไม่กระทบสิ่งที่ต้องจ่าย”

Concept:

```text
Available liquid balance
- upcoming recurring bills
- committed budgets
- savings reserve
- debt obligations
- estimated tax reserve
= Safe to Spend
```

User settings should allow:

- savings target
- minimum balance
- safety buffer
- tax reserve enabled/disabled

---

# 13. Recurring Transactions

Examples:

- rent
- internet
- mobile
- subscriptions
- salary
- installments

Fields:

- title
- amount
- frequency
- next date
- category
- account
- type
- active

Used by Safe to Spend forecast.

---

# 14. Data Model

Core tables:

```text
users
profiles

accounts

transactions
transaction_categories
transaction_tags

people
merchants

slips
documents

budgets
budget_periods

recurring_transactions

income_sources

tax_profiles
tax_rules
tax_brackets
tax_deductions
tax_deduction_entries
withholding_tax
tax_calculations

ai_classification_logs
transaction_corrections

notifications
audit_logs
```

---

# 15. Transaction Schema

Suggested conceptual schema:

```text
transactions
├── id
├── user_id
├── type
├── amount
├── currency
├── transaction_date
├── description
├── note
│
├── from_account_id
├── to_account_id
│
├── person_id
├── merchant_id
│
├── category_id
│
├── payment_method
│
├── source
│   ├ manual
│   ├ slip
│   ├ import
│   ├ shortcut
│
├── source_document_id
├── source_slip_id
│
├── reference_number
│
├── tax_income_type
├── tax_deductible
├── tax_year
│
├── confidence
├── review_status
│
├── created_at
└── updated_at
```

---

# 16. Person Schema

```text
people
├── id
├── user_id
├── display_name
├── normalized_name
├── aliases[]
├── phone_optional
├── note
└── timestamps
```

Must support aliases:

```text
นาย สมชาย ใจดี
สมชาย
SOMCHAI J.
```

→ same person

---

# 17. Merchant Schema

```text
merchants
├── id
├── normalized_name
├── display_name
├── category_hint
├── aliases[]
└── metadata
```

---

# 18. Account Schema

```text
accounts
├── id
├── user_id
├── name
├── institution
├── type
├── masked_number
├── opening_balance
├── current_balance
├── currency
├── active
└── timestamps
```

Balance must be calculated deterministically.

---

# 19. Slip Schema

```text
slips
├── id
├── user_id
├── storage_path
├── file_hash
├── qr_payload
├── ocr_text
├── parsed_json
├── parser_version
├── confidence
├── verification_status
├── created_transaction_id
└── timestamps
```

---

# 20. Tax Rule Schema

```text
tax_rules
├── id
├── country
├── tax_year
├── rule_type
├── code
├── config_json
├── source_reference
├── effective_from
├── effective_to
└── active
```

Rule types:

- bracket
- income_expense_deduction
- personal_deduction
- tax_credit
- withholding
- threshold
- special_program

---

# 21. Tax Calculation Engine

Pseudo-flow:

```text
Recorded Transactions
↓
Identify taxable income
↓
Group by tax income type
↓
Apply allowed expense rules
↓
Apply configured deductions
↓
Calculate net taxable income
↓
Apply tax brackets
↓
Apply tax credits / withholding
↓
Estimated tax payable
```

Important:

The Tax Engine output should contain a breakdown.

Example:

```json
{
  "taxYear": 2026,
  "grossIncome": 420000,
  "allowableExpenses": 100000,
  "deductions": 60000,
  "netTaxableIncome": 260000,
  "calculatedTax": 5500,
  "withholdingTax": 3000,
  "estimatedTaxDue": 2500
}
```

Never store only the final number.

---

# 22. Manual Entry

Even though automation is primary, manual entry must remain fast.

Add Transaction form:

Fields:

- type
- amount
- date
- account
- person / merchant
- category
- note
- tax classification optional
- attachment optional

Target:

Common manual transaction should take < 10 seconds.

---

# 23. Review Inbox

Important feature.

All uncertain automated items go here.

Example:

```text
Review 3 items

฿189
ABC SHOP
Expense
Food
Confidence 82%

[Confirm] [Edit]
```

Review states:

- pending
- confirmed
- corrected
- rejected

---

# 24. Search

Global search should support:

```text
"สมชาย"
"7-eleven"
"500"
"14 sep"
"SCB"
"ค่าห้อง"
```

Search targets:

- transactions
- people
- merchants
- documents
- notes
- references

---

# 25. Notifications

Useful notifications:

- transaction imported
- transaction needs review
- possible duplicate
- budget near limit
- budget exceeded
- recurring payment due
- tax classification missing
- tax reserve changed significantly
- deduction evidence missing

Do not over-notify.

---

# 26. Settings

Sections:

## Profile
- name
- currency
- timezone
- country

## Accounts
- bank accounts
- cash
- wallets

## Categories
- custom categories

## Automation
- Shortcut token
- API access
- import settings

## Tax
- country
- tax year
- taxpayer profile
- deductions
- withholding

## AI
- enable suggestions
- auto classification
- auto-save confidence threshold

## Security
- sessions
- PIN / biometric future support
- data export
- delete account

---

# 27. Security Requirements

Financial data is sensitive.

Minimum requirements:

- authentication required
- row-level security
- encrypted transport HTTPS
- private storage buckets
- signed URLs
- no public slip files
- audit logs for destructive changes
- secure API token for Shortcut
- rate limiting
- validation on all uploaded files
- strip unsafe metadata if needed

Never log full financial documents into plain console logs in production.

---

# 28. Privacy

Users must be able to:

- export all data
- delete documents
- delete transactions
- delete account
- disable AI processing
- choose whether raw OCR text is stored

---

# 29. Auditability

Every auto-created transaction should preserve:

```text
source
parser version
raw extracted values
normalized values
confidence
user corrections
```

This makes debugging possible.

---

# 30. UI Direction

Avoid:

- generic AI dashboard look
- excessive gradients
- glowing cards
- too many rounded floating boxes
- neon accents
- chat-first layout

Desired:

- modern fintech
- clean
- calm
- dense enough to be useful
- strong typography
- clear numbers
- strong hierarchy
- mobile first
- minimal visual noise

Inspiration direction:

- financial dashboard
- mobile banking
- budgeting tools
- modern accounting products

Use charts only when they answer a useful question.

---

# 31. Number Formatting

Thai Baht:

```text
฿12,450
```

Income:

```text
+฿4,800
```

Expense:

```text
-฿389
```

Never rely on color alone to indicate income/expense.

Always combine:

- sign
- label
- icon
- color optionally

---

# 32. Empty States

Examples:

Today:

```text
ยังไม่มีรายการวันนี้
เพิ่มรายการ หรือแชร์สลิปเข้ามาได้เลย
```

People:

```text
ยังไม่มีข้อมูลบุคคล
เมื่อมีรายการรับ/จ่าย ระบบจะเริ่มสร้างรายชื่อให้โดยอัตโนมัติ
```

Tax:

```text
ยังประเมินภาษีไม่ได้
เพิ่มหรือจัดประเภทรายได้ก่อน
```

---

# 33. Error Handling

Examples:

Slip unreadable:

```text
อ่านสลิปนี้ไม่สำเร็จ
ลองใช้รูปที่ชัดขึ้น หรือกรอกข้อมูลด้วยตัวเอง
```

Duplicate:

```text
รายการนี้อาจถูกบันทึกแล้ว
```

Tax incomplete:

```text
ยังมีรายได้ 3 รายการที่ไม่ได้จัดประเภทภาษี
```

Never show raw stack traces to users.

---

# 34. Phase Plan

# Phase 1 — Money Core

Build:

- Auth
- Today
- Overview
- Accounts
- Transactions
- Income
- Expense
- Transfer
- Categories
- People
- Merchants
- Monthly summary
- Manual entry

Definition of Done:

User can fully track personal money manually.

---

# Phase 2 — Slip Automation

Build:

- Slip upload
- QR decode
- OCR
- AI parser
- auto categorization
- person matching
- merchant matching
- duplicate detection
- confidence
- review inbox
- iOS Shortcut endpoint

Definition of Done:

User can share a banking slip from iPhone and get a transaction without typing the amount manually.

---

# Phase 3 — Budget + Safe to Spend

Build:

- budgets
- recurring expenses
- savings reserve
- Safe to Spend
- warnings
- monthly forecast

Definition of Done:

App tells the user how much money can safely be spent.

---

# Phase 4 — Tax Engine

Build:

- tax profile
- income tax classification
- versioned tax rules
- expense deduction rules
- personal deductions
- withholding tax
- tax forecast
- tax reserve
- tax alerts
- documents linkage

Definition of Done:

App can provide an explainable estimated tax result based on configured rules and recorded user data.

---

# Phase 5 — AI Intelligence

Build:

- assistant
- spending insights
- budget anomaly
- merchant trends
- person insights
- forecast explanations
- tax explanation
- smart search

Definition of Done:

User can ask natural-language questions about their own financial data.

---

# 35. MVP Scope

Do NOT build everything at once.

MVP should contain only:

```text
Auth
Today
Accounts
Transactions
Income
Expense
Transfer
Categories
People
Overview
Slip Upload
Slip Parser
Review Inbox
Basic Monthly Summary
```

Do not include full tax engine in MVP.

Tax comes after financial data is reliable.

---

# 36. Non-Goals for Initial Version

Do not build initially:

- direct bank API integration
- banking credentials storage
- money transfer execution
- investing platform
- loan approval
- accounting ERP
- corporate tax
- multi-company accounting
- automatic tax filing
- native iOS app
- Android app
- multi-currency advanced accounting

---

# 37. Future Expansion

Possible future modules:

- Native iOS App
- Share Extension
- Android App
- bank Open API if legally/technically available
- receipt scanner
- subscription detector
- debt tracker
- investment portfolio
- savings goals
- financial calendar
- family mode
- shared expenses
- invoice generation
- freelancer mode
- business mode
- tax document export
- accountant export package

---

# 38. Success Metrics

Track:

- % transactions auto-created
- % slips parsed successfully
- average correction rate
- duplicate prevention rate
- time to add transaction
- number of manual fields per transaction
- category accuracy
- person matching accuracy
- monthly active usage
- review inbox completion
- tax classification completeness

Target philosophy:

> The app becomes more useful as it learns from the user's corrections.

---

# 39. Agent Implementation Rules

Agent must follow these rules:

1. Do not invent features outside this spec unless necessary.
2. Do not hard-code user-specific sample data.
3. Separate business logic from UI.
4. Tax logic must never live only in React components.
5. All calculations must be deterministic.
6. AI must not be trusted for financial arithmetic.
7. Transactions are the central source of truth.
8. Transfers between own accounts must not affect income/expense totals.
9. Preserve source and confidence for imported transactions.
10. Always support manual correction.
11. Build mobile-first.
12. Do not redesign navigation without updating this spec.
13. Do not build all phases at once.
14. Complete each phase with tests before proceeding.
15. Keep the app independent from the Weight Loss App.

---

# 40. Recommended Repository Structure

```text
src/
├── app/
│   ├── (auth)/
│   ├── (dashboard)/
│   │   ├── today/
│   │   ├── overview/
│   │   ├── transactions/
│   │   ├── people/
│   │   ├── accounts/
│   │   ├── budgets/
│   │   ├── tax/
│   │   ├── documents/
│   │   ├── insights/
│   │   └── settings/
│   │
│   └── api/
│       ├── transactions/
│       ├── slips/
│       ├── ingest/
│       ├── tax/
│       └── assistant/
│
├── components/
│   ├── finance/
│   ├── transactions/
│   ├── charts/
│   ├── tax/
│   └── ui/
│
├── lib/
│   ├── finance/
│   ├── tax/
│   ├── slip/
│   ├── ai/
│   ├── validation/
│   └── supabase/
│
├── types/
└── config/
```

---

# 41. Testing Requirements

Minimum:

## Unit Tests

- transaction totals
- account balance
- transfers
- Safe to Spend
- duplicate detection
- tax calculation engine

## Integration Tests

- create transaction
- edit transaction
- slip ingest
- parser output
- review flow
- document linking

## E2E

Use Playwright.

Critical flows:

```text
Login
Add expense
Add income
Transfer between accounts
Upload slip
Review parsed slip
View dashboard
View person history
```

Tax flows later:

```text
Add taxable income
Add deduction
Add withholding
Calculate forecast
```

---

# 42. Product Definition

This product is not:

> “an expense tracker”

It is:

> “a personal financial operating system that turns real-world transactions into structured financial data and helps the user understand spending, cash flow, people, budgets, and tax obligations with minimal manual input.”

---

# 43. First Development Objective

The first implementation milestone is:

> Build a reliable Money Core before adding intelligence.

Priority order:

```text
1. Transactions
2. Accounts
3. People / Merchants
4. Categories
5. Dashboard
6. Slip ingestion
7. Review system
8. Automation
9. Budget / Forecast
10. Tax
11. AI Assistant
```

---

# 44. Final Rule

Never optimize for “looks intelligent”.

Optimize for:

> Accurate financial data  
> Minimal user effort  
> Explainable calculations  
> Fast correction  
> Trust
