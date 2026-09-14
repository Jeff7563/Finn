# PROMPT_UI_V2.md
# Agent Prompt — Redesign Finn UI Using UI_SPEC_V2.md

You are a senior product designer and senior frontend engineer working on an existing personal finance web application called Finn.

Your task is to redesign the EXISTING application using the attached:

- `PRODUCT_SPEC.md`
- `UI_SPEC_V2.md`

This is a UI/UX redesign, not a greenfield rebuild.

Read both files before making implementation decisions.

---

# PRIMARY OBJECTIVE

Transform Finn from a clean but traditional accounting/admin-dashboard appearance into a modern personal finance experience.

Target feel:

> Modern Personal Finance + Mobile Banking + Calm Premium Productivity

The redesign must improve:

- typography
- hierarchy
- spacing
- responsive behavior
- transaction UX
- account presentation
- Thai-first copy
- mobile usability
- visual trust

while preserving all existing financial behavior.

---

# NON-NEGOTIABLE RULE

DO NOT BREAK FINANCE LOGIC.

Preserve:

- transactions as source of truth
- account balance calculations
- transfer isolation
- income/expense calculations
- existing Supabase auth architecture
- RLS behavior
- user ownership validation
- existing database relationships
- existing finance utilities
- existing tests

This task is primarily presentation-layer work.

Do not rewrite backend systems unless a very small change is genuinely necessary to support the new UI.

---

# STEP 1 — INSPECT BEFORE EDITING

Before changing code:

1. Read `PRODUCT_SPEC.md`
2. Read `UI_SPEC_V2.md`
3. Inspect repository structure
4. Inspect existing routes
5. Inspect current design system / globals.css
6. Inspect finance calculation files
7. Inspect Supabase/auth integration
8. Inspect reusable components
9. Inspect Playwright and unit tests
10. Identify files that should change for UI only

Do not replace the project blindly.

---

# CURRENT UI PROBLEMS TO FIX

The current interface is structurally usable but visually too close to:

- ERP software
- old accounting dashboards
- admin templates
- legacy finance portals

Specific issues:

- serif-heavy typography
- too many bordered white cards
- large empty-state panels
- excessive unused desktop whitespace
- weak hierarchy
- repeated CTA buttons
- generic English copy
- sidebar feels like a SaaS admin template
- Overview feels like BI software
- People and Merchants feel like separate admin modules
- Settings feels too developer-oriented

---

# DESIGN SOURCE OF TRUTH

Use `UI_SPEC_V2.md` as the primary UI/UX source of truth.

If a visual decision is not explicitly described, follow these principles:

- calm
- modern
- restrained
- personal
- premium
- practical
- trustworthy
- Thai-first
- mobile-first

Avoid:

- gradients
- neon
- glassmorphism
- glowing cards
- generic AI dashboard styling
- crypto aesthetics
- excessive charts
- excessive card containers
- serif headings
- spreadsheet-first presentation

---

# TYPOGRAPHY

Remove serif fonts from the product UI.

Use a modern sans-serif stack with good Thai support.

Preferred:

```text
Geist
Noto Sans Thai
Inter
system-ui
```

If external font loading is not reliable, use a stable fallback stack.

Money values must be highly readable.

Use tabular numerals where appropriate.

---

# LANGUAGE

Move the primary interface to Thai-first.

Examples:

```text
Today → วันนี้
Overview → ภาพรวม
Transactions → รายการ
Accounts → บัญชี
People/Merchants navigation → คนและร้านค้า
Categories → หมวดหมู่
Settings → ตั้งค่า
```

Internal code, route names, types, and database names may remain English.

Do not translate user-entered names.

---

# NAVIGATION

Desktop target:

```text
Finn

วันนี้

ภาพรวม
รายการ
บัญชี
คนและร้านค้า

หมวดหมู่

────────
ตั้งค่า
```

Do not show unimplemented future modules.

Do not merge People and Merchants database models.

You may expose both through a unified UI concept.

If introducing `/contacts` would risk breaking routes/tests, preserve `/people` and `/merchants` and create a safe tabbed navigation experience around them.

---

# MOBILE NAVIGATION

Implement:

```text
วันนี้
รายการ
+
ภาพรวม
เพิ่มเติม
```

The center `+` opens transaction creation.

`เพิ่มเติม` should expose:

- บัญชี
- คนและร้านค้า
- หมวดหมู่
- ตั้งค่า

Respect mobile safe-area.

Target iPhone 11 Pro Max first.

---

# TODAY PAGE REDESIGN

The page should answer:

1. มีเงินเท่าไร
2. เดือนนี้เงินเข้า/ออกเท่าไร
3. ล่าสุดมีรายการอะไร

Required hierarchy:

```text
สวัสดีตอนบ่าย

ยอดเงินทั้งหมด
฿28,450

+฿9,180 เดือนนี้

รายรับ        รายจ่าย        สุทธิ
+฿17,600      -฿8,420        +฿9,180

[+ รายจ่าย] [+ รายรับ] [โอนเงิน]

รายการล่าสุด
...
```

Rules:

- balance is visually dominant
- reduce bordered card grid
- do not show a large Safe-to-Spend placeholder
- do not duplicate Add Transaction actions
- recent transactions should be visually strong
- use actual display name if available
- do not show "Hello, Fintech User"

---

# OVERVIEW REDESIGN

Do not lead with a 4-card BI dashboard.

Prioritize:

- monthly cash flow
- income vs expense
- one useful 6-month trend
- spending category ranking
- account snapshot
- compact people/merchant insights

Do not render fake zero-value charts when no data exists.

Prefer an empty state.

Use ranked spending list rather than oversized chart where appropriate.

---

# TRANSACTIONS REDESIGN

Create a polished personal-finance ledger.

Required:

- one clear Add Transaction action
- search
- compact filters
- quick type filters
- group transactions by date
- align money values cleanly
- show category/account metadata
- mobile list layout

Example:

```text
วันนี้

7-Eleven
อาหาร · SCB                           -฿82

เงินเดือน
รายรับ · KBank                    +฿4,800
```

Avoid spreadsheet-style UI.

---

# ADD TRANSACTION REDESIGN

Keep finance behavior unchanged.

Use segmented mode:

```text
รายจ่าย | รายรับ | โอนเงิน
```

Amount first:

```text
จำนวนเงิน
฿ 0
```

Expense:
1. Amount
2. Account
3. Merchant / Person
4. Category
5. Date
6. Note

Income:
1. Amount
2. Account
3. Person / Source
4. Category
5. Date
6. Note

Transfer:
1. Amount
2. From Account
3. To Account
4. Date
5. Note

On mobile:
- numeric keyboard
- sticky save action
- safe-area aware

Do not alter transfer exclusion logic.

---

# ACCOUNTS REDESIGN

Accounts should feel like a wallet.

Example:

```text
SCB
บัญชีเงินเดือน · ••1234

฿12,450
```

Use balance emphasis.

Use compact account cards/rows.

Do not make the page feel like CRUD admin software.

---

# SECURITY-SENSITIVE UI RULES

Mandatory.

Do NOT add fields for:

- bank password
- internet banking password
- mobile banking PIN
- ATM PIN
- OTP
- CVV

Do NOT collect full credit card numbers in Phase 1.

For account/card identifiers use:

- optional last 4 digits
- masked identifier

Examples:

```text
SCB ••1234
•••• 4242
```

Do not display full identifiers by default.

Do not place sensitive values in:

- URL query strings
- page titles
- toast text
- analytics events
- console logs

Do not weaken current auth/RLS behavior.

---

# SECURITY CLAIMS

Do not display statements like:

```text
Your data is completely secure.
Your data is fully encrypted.
```

unless technically verified.

Use conservative wording only.

This redesign does NOT replace the later security audit.

---

# CONTACTS REDESIGN

Expose:

```text
บุคคล | ร้านค้า
```

under one navigation concept.

Keep existing backend separation.

Example people row:

```text
Somchai
12 รายการ                          -฿2,000 สุทธิ
```

Example merchant row:

```text
7-Eleven
12 รายการ · อาหาร                      ฿1,320
```

Do not add external merchant-logo dependencies.

---

# CATEGORIES REDESIGN

Replace the admin-style category tile grid with a cleaner list or compact grid.

Tabs:

```text
รายจ่าย | รายรับ
```

Action:

```text
+ สร้างหมวดหมู่
```

Reduce repeated `DEFAULT` badges.

Use subtle system/default indication only when necessary.

---

# SETTINGS REDESIGN

Group:

```text
บัญชีผู้ใช้
การเงิน
ความเป็นส่วนตัวและความปลอดภัย
ข้อมูลและการส่งออก
สำหรับนักพัฒนา
```

Keep sample/demo-data functionality if tests rely on it.

But place it under developer/demo tools.

If possible, hide developer controls in production using environment conditions.

Do not present developer/demo controls as normal consumer settings.

---

# LOGIN / SIGNUP REDESIGN

Update auth pages to match V2.

Requirements:

- sans-serif
- compact
- modern
- clean brand hierarchy
- not legacy banking portal style

Keep existing email/password behavior.

If demo mode remains necessary, label:

```text
ทดลองใช้งาน
```

and visually distinguish:

```text
โหมดทดลอง — ข้อมูลนี้เป็นตัวอย่าง
```

Never turn demo mode into a production authentication bypass.

---

# EMPTY STATES

Replace large empty bordered boxes.

Use compact empty states:

```text
ยังไม่มีรายการ

เพิ่มรายรับหรือรายจ่ายรายการแรก
เพื่อเริ่มดูภาพรวมการเงินของคุณ

[+ เพิ่มรายการ]
```

Accounts:

```text
ยังไม่มีบัญชี

เพิ่มบัญชีธนาคาร เงินสด หรือ E-wallet
เพื่อเริ่มติดตามยอดเงิน

[+ เพิ่มบัญชี]
```

Contacts:

```text
ยังไม่มีข้อมูล

เมื่อคุณเริ่มบันทึกรายการ
บุคคลและร้านค้าจะปรากฏที่นี่
```

---

# COMPONENT STRATEGY

Prefer reusable UI components such as:

```text
AppShell
Sidebar
MobileNav
TopBar
PageHeader
SectionHeader
MoneyAmount
TransactionRow
TransactionGroup
AccountRow
ContactRow
CategoryRow
EmptyState
SearchField
FilterButton
SegmentedControl
Dialog
Sheet
Toast
Skeleton
```

Do not build an unnecessarily abstract design system.

---

# DESIGN TOKENS

Refactor visual tokens where useful:

```text
--bg
--surface
--surface-subtle
--text
--text-muted
--border
--income
--expense
--transfer
--warning
```

Do not hardcode random colors throughout components.

Dark mode is not required.

---

# CARDS

Reduce card usage significantly.

Cards are appropriate for:

- account modules
- important summaries
- dialogs
- grouped content where containment matters

Do not put every metric/section inside a bordered card.

Prefer:

- whitespace
- alignment
- typography
- separators

---

# BUTTONS

Use:

Primary:
- dark neutral background
- white text
- clear focus/hover state

Secondary:
- neutral surface
- subtle border

Destructive:
- semantic red
- confirmation

Avoid:
- gradient buttons
- excessive pills
- oversized CTAs

---

# RESPONSIVE

Below 768px:

- hide sidebar
- bottom nav
- one-column layout
- drawers/sheets for filters
- mobile-safe dialogs
- safe-area padding
- no desktop tables

Desktop:

- compact sidebar
- centered main container
- controlled maximum width
- useful multi-column layouts only

---

# ACCESSIBILITY

Required:

- labels
- visible focus states
- keyboard navigation
- minimum 44px mobile target
- color-independent meaning
- accessible dialogs
- validation messages
- reasonable contrast

---

# FORMATTING

Money:

```text
฿12,450
+฿4,800
-฿389
```

Transfer:

```text
฿5,000
SCB → KBank
```

Do not alter underlying financial precision.

Dates can be displayed Thai-first:

```text
14 ก.ย. 2569
วันนี้ 12:42
เมื่อวาน 18:15
```

Do not alter date storage semantics.

---

# ROUTES IN SCOPE

Redesign existing:

```text
/login
/signup
/today
/overview
/transactions
/transactions/new
/transactions/[id]
/accounts
/people
/people/[id]
/merchants
/merchants/[id]
/categories
/settings
```

Optional `/contacts` only if safe.

---

# DO NOT IMPLEMENT FUTURE PHASES

Do not implement:

- Slip OCR
- QR parsing
- direct bank integrations
- Budget engine
- Safe to Spend calculation
- Tax Engine
- AI Assistant
- document system
- card payment processing
- investment expansion

This task is UI V2 only.

---

# DO NOT CHANGE WITHOUT STRONG REASON

Avoid changes to:

```text
supabase/migrations
finance calculation files
transaction semantics
RLS policies
auth ownership model
database schema
API contracts
```

If you believe any must change, document why before changing it.

Prefer solving the problem in the presentation layer.

---

# IMPLEMENTATION ORDER

Use this sequence:

1. Audit existing UI
2. Set typography, spacing, semantic tokens
3. Redesign AppShell and navigation
4. Redesign login/signup
5. Redesign Today
6. Redesign Transactions
7. Redesign Add/Edit Transaction
8. Redesign Overview
9. Redesign Accounts
10. Redesign People + Merchants / Contacts UX
11. Redesign Categories
12. Redesign Settings
13. Mobile responsive QA
14. Run tests/build
15. Fix regressions

Do not do one uncontrolled full-project rewrite.

---

# TESTING

After redesign run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test
```

If the repo uses different script names, inspect `package.json` and use the actual equivalents.

Verify:

```text
income totals unchanged
expense totals unchanged
transfers excluded from income/expense
account balances reconcile
ownership validation remains intact
auth still works
demo mode works only as intended
```

Do not claim success if tests fail.

---

# VISUAL QA

Manually inspect:

```text
390px
430px
768px
1024px
1440px
```

Pay special attention to:

- iPhone navigation
- transaction form
- long Thai text
- amount overflow
- empty states
- dialogs
- filter behavior
- safe-area
- sidebar density

---

# DELIVERY

At completion provide:

1. UI redesign summary
2. files changed
3. routes redesigned
4. navigation changes
5. any deviations from UI_SPEC_V2.md
6. test/build results
7. visual QA notes for:
   - Today desktop
   - Today mobile
   - Overview
   - Transactions desktop
   - Transactions mobile
   - Accounts
   - Contacts
   - Settings

Do not say "complete" while there are unresolved build/test errors.

---

# FINAL RULE

Do not optimize for visual novelty.

Optimize for:

- clarity
- speed
- trust
- hierarchy
- financial readability
- mobile usability
- consistency

The final UI should feel like a modern personal finance product someone would willingly use every day.
