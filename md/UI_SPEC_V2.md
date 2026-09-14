# UI_SPEC_V2.md
# Finn — Personal Finance OS
## UI Redesign Specification v2.0

> Scope: Redesign the existing Phase 1 presentation layer.
> Product: Finn — Personal Finance OS
> Platform: Web App / PWA
> Primary device: iPhone 11 Pro Max + desktop
> This is a UI/UX redesign, not a rewrite of finance logic.

---

## 1. Objective

Redesign Finn from a clean but traditional accounting/admin dashboard into a modern personal finance product.

The current product is structurally useful, but visually feels too close to:
- ERP software
- admin dashboards
- traditional accounting tools
- generic SaaS templates

The new direction is:

> Modern Personal Finance + Mobile Banking + Calm Premium Productivity

Finn should feel personal, modern, trustworthy, fast, and designed for daily use.

Priority order:
1. Financial clarity
2. Fast interaction
3. Mobile usability
4. Strong hierarchy
5. Low cognitive load
6. Trust

---

## 2. Product Positioning

Finn is NOT:
- an ERP
- a corporate accounting system
- a banking app that moves money
- a card vault
- an AI-first chat interface
- a crypto/trading terminal

Finn IS:

> A personal financial operating system that helps the user understand accounts, transactions, people, spending, and future financial obligations.

---

## 3. Existing Logic Must Stay Intact

Do not break or redesign the financial core.

Preserve:
- transactions as source of truth
- deterministic calculations
- transfer isolation
- account balance reconciliation
- Supabase authentication
- user ownership validation
- RLS architecture
- existing database schema unless absolutely required
- finance utilities
- tests

UI work must not change financial meaning.

---

## 4. Design Personality

The new Finn should feel:
- modern
- restrained
- premium
- calm
- lightweight
- personal
- trustworthy

Avoid:
- futuristic AI styling
- neon
- glassmorphism
- glowing cards
- excessive gradients
- crypto aesthetics
- overly corporate ERP styling
- playful gamification

---

## 5. Typography

Remove serif-heavy typography.

Use a modern sans-serif stack with good Thai support.

Preferred:
```text
Geist
Noto Sans Thai
Inter
system-ui
```

Suggested CSS:
```css
font-family: "Geist", "Noto Sans Thai", "Inter", system-ui, sans-serif;
```

Hierarchy:
```text
Page title       28–32px / semibold
Hero balance     40–48px / semibold
Section title    18–20px / semibold
Body             14–16px
Secondary        13–14px
Metadata         12–13px
```

Use tabular numerals for money where appropriate.

---

## 6. Color System

Use a restrained neutral palette.

Base:
```text
Background       soft near-white
Surface          white
Surface subtle   light neutral gray
Text             very dark neutral
Muted text       medium gray
Border           subtle neutral
```

Semantic:
```text
Income           green
Expense          red
Transfer         blue
Warning          amber
```

Do not rely on color alone. Always combine semantic color with sign, icon, label, or direction.

Avoid:
- purple AI gradients
- neon green
- saturated blue everywhere
- glowing components

---

## 7. Layout

Desktop:
```text
Sidebar          224–240px
Main width       max 1120–1240px
Page padding     32–40px
```

Do not stretch content edge-to-edge on large monitors.

Mobile:
- single column
- 16–20px horizontal padding
- touch targets at least 44px
- bottom navigation
- safe-area support
- no desktop tables

Primary mobile target:
- iPhone 11 Pro Max

---

## 8. Navigation

### Desktop

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

Do not show future features until implemented:
- Budgets
- Tax
- Documents
- AI Assistant

### Mobile Bottom Navigation

```text
วันนี้
รายการ
+
ภาพรวม
เพิ่มเติม
```

Center `+` opens Add Transaction.

`เพิ่มเติม` contains:
- บัญชี
- คนและร้านค้า
- หมวดหมู่
- ตั้งค่า

---

## 9. Contacts Concept

In navigation, combine People and Merchants into one concept:

```text
คนและร้านค้า
```

Inside:
```text
[ บุคคล ] [ ร้านค้า ]
```

Important:
- DO NOT merge database tables
- keep `people` and `merchants` separate internally

---

## 10. Language Direction

Use Thai-first UI.

Examples:
```text
Today          → วันนี้
Overview       → ภาพรวม
Transactions   → รายการ
Accounts       → บัญชี
Contacts       → คนและร้านค้า
Categories     → หมวดหมู่
Settings       → ตั้งค่า
```

Code, routes, and database naming may remain English.

Avoid mixing Thai/English unnecessarily in the same UI.

---

# 11. Today Page

Today should answer in under 5 seconds:
1. ตอนนี้มีเงินเท่าไร
2. เดือนนี้เงินเข้า/ออกเท่าไร
3. ล่าสุดมีรายการอะไร
4. ต้องทำอะไรต่อหรือไม่

### Header

Use:
```text
สวัสดีตอนบ่าย
14 กันยายน 2569
```

If profile name exists:
```text
สวัสดีตอนบ่าย, Jeff
```

Do not use generic:
```text
Hello, Fintech User
```

### Balance Hero

Make balance the strongest element.

```text
ยอดเงินทั้งหมด

฿28,450

+฿9,180 เดือนนี้
3 บัญชี
```

Avoid putting this inside a heavy bordered dashboard card unless necessary.

### Monthly Cash Flow

Compact section:

```text
เดือนนี้

รายรับ        รายจ่าย        สุทธิ
+฿17,600      -฿8,420        +฿9,180
```

### Quick Actions

```text
+ รายจ่าย
+ รายรับ
↔ โอนเงิน
```

Do not repeat Add Transaction CTA multiple times on the same screen.

### Safe to Spend

Phase 1 does not calculate this.

Preferred:
- hide it for now

Alternative:
```text
ใช้ได้อย่างปลอดภัย
กำลังมาใน Budget & Forecast
```

Do not give it a large hero card.

### Recent Transactions

Strong section:

```text
รายการล่าสุด                     ดูทั้งหมด

[icon]  7-Eleven
        อาหาร · วันนี้ 12:42              -฿82
        SCB

[icon]  เงินเดือน
        รายรับ · วันนี้ 09:00          +฿4,800
        KBank
```

For transfer:
```text
โอนระหว่างบัญชี
SCB → KBank                       ฿5,000
```

---

# 12. Overview Page

Overview should feel like personal financial insight, not BI software.

### Header
```text
ภาพรวม                     กันยายน 2569⌄
```

### Main Cash Flow
```text
กระแสเงินสดเดือนนี้
+฿9,180

รายรับ ฿17,600
รายจ่าย ฿8,420
```

### Trend
Use one useful 6-month chart.

Only show actual data. If no data, show a proper empty state instead of fake zero bars.

### Spending Breakdown

Prefer ranked list:

```text
เงินออกไปกับอะไร

อาหาร                    ฿2,850   34%
██████████████

เดินทาง                   ฿1,510   18%
████████

ช้อปปิ้ง                  ฿1,090   13%
██████
```

Show top 5.

### Accounts Snapshot
```text
บัญชีของฉัน

SCB ••1234                       ฿12,450
KBank ••5678                      ฿8,900
เงินสด                             ฿1,200
```

### People / Merchant Insight
Do not render two giant empty panels.

Show compact insight only if data exists.

---

# 13. Transactions Page

Use a personal-finance ledger, not an admin table.

### Header
```text
รายการทั้งหมด                 + เพิ่มรายการ
```

### Search/Filters

Desktop:
```text
[ ค้นหารายการ...                     ] [ตัวกรอง]
```

Quick filters:
```text
ทั้งหมด   รายจ่าย   รายรับ   โอน
```

Do not show duplicate Add buttons.

### Group by Date

```text
วันนี้ · 14 ก.ย.

7-Eleven
อาหาร · SCB                           -฿82

เงินเดือน
รายรับ · KBank                    +฿4,800


เมื่อวาน · 13 ก.ย.

Lotus's
ของใช้ · SCB                         -฿389
```

Desktop may show extra metadata, but keep list-style identity.

---

# 14. Add Transaction

Use a fast flow.

Mode selector:
```text
รายจ่าย | รายรับ | โอนเงิน
```

Amount is first and visually strongest:
```text
จำนวนเงิน

฿ 0
```

Expense order:
1. Amount
2. Account
3. Merchant / Person
4. Category
5. Date
6. Note

Income order:
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

Mobile:
- numeric keyboard
- sticky save action above safe area

---

# 15. Accounts Page

Make Accounts feel like a wallet, not a database module.

Header:
```text
บัญชี                          + เพิ่มบัญชี
```

Account example:
```text
SCB
บัญชีเงินเดือน · ••1234

฿12,450
```

Supported labels:
```text
ธนาคาร
เงินสด
E-wallet
บัตรเครดิต
การลงทุน
อื่น ๆ
```

---

# 16. Security & Sensitive Data UI Rules

Mandatory.

Finn must NEVER request:
- bank password
- internet banking password
- mobile banking PIN
- ATM PIN
- OTP
- CVV

Do not collect full credit card number in Phase 1.

For bank/card identifiers, prefer:
```text
เลขท้าย 4 หลัก
```

Display:
```text
SCB ••1234
•••• 4242
```

Do not expose full identifiers by default.

Do not put sensitive identifiers in:
- URLs
- toast messages
- browser titles
- analytics events
- console logs

---

# 17. Security Claims

Do not display unverifiable claims such as:
```text
Your data is completely secure.
Your data is fully encrypted.
```

Safer:
```text
ข้อมูลของคุณถูกจำกัดการเข้าถึงตามบัญชีผู้ใช้
```

Only make encryption/security claims after implementation is audited.

---

# 18. Contacts Page

Tabs:
```text
บุคคล | ร้านค้า
```

People row:
```text
Somchai
12 รายการ                          -฿2,000 สุทธิ
```

Merchant row:
```text
7-Eleven
12 รายการ · อาหาร                      ฿1,320
```

No external merchant logo fetching in Phase 1.

---

# 19. Categories

Move away from the current admin-style tile grid.

Use:
```text
หมวดหมู่

[ รายจ่าย ] [ รายรับ ]

อาหาร
เดินทาง
น้ำมัน
ค่าเช่า
...
```

Use subtle system/default labeling.

Avoid repeated loud `DEFAULT` badges.

Action:
```text
+ สร้างหมวดหมู่
```

---

# 20. Settings

Use consumer-app sections:

```text
บัญชีผู้ใช้
การเงิน
ความเป็นส่วนตัวและความปลอดภัย
ข้อมูลและการส่งออก
สำหรับนักพัฒนา
```

Development/demo tools must be separated from normal settings.

`Load Sample Data` should be development-only where possible.

Do not show demo/developer controls in production.

---

# 21. Login / Signup

Redesign auth screens:
- sans-serif
- modern
- compact
- strong hierarchy
- less legacy-bank feeling

Keep:
- email/password
- demo option if needed for development

Label demo clearly:
```text
ทดลองใช้งาน
```

Demo mode must not become a production authentication bypass.

If in demo:
```text
โหมดทดลอง — ข้อมูลนี้เป็นตัวอย่าง
```

---

# 22. Empty States

Avoid giant bordered panels.

Transactions:
```text
ยังไม่มีรายการ

เพิ่มรายรับหรือรายจ่ายรายการแรก
เพื่อเริ่มดูภาพรวมการเงินของคุณ

[ + เพิ่มรายการ ]
```

Accounts:
```text
ยังไม่มีบัญชี

เพิ่มบัญชีธนาคาร เงินสด หรือ E-wallet
เพื่อเริ่มติดตามยอดเงิน

[ + เพิ่มบัญชี ]
```

Contacts:
```text
ยังไม่มีข้อมูล

เมื่อคุณเริ่มบันทึกรายการ
บุคคลและร้านค้าจะปรากฏที่นี่
```

---

# 23. Components

Recommended:
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

Do not over-abstract.

---

# 24. Icons

Use one consistent icon library.

Recommended:
- Lucide
- or existing project icon library

Do not mix icon styles.

---

# 25. Cards

Use fewer cards.

Good card use:
- account
- modal
- key summary
- meaningful grouped module

Bad card use:
- every metric
- every row
- every section

Prefer:
- whitespace
- typography
- alignment
- dividers

---

# 26. Buttons

Primary:
- dark neutral
- white text
- clear focus/hover

Secondary:
- neutral surface
- subtle border

Destructive:
- red semantic action
- confirmation required

Avoid:
- gradients
- giant pill buttons
- excessive rounded buttons

---

# 27. Radius

Suggested:
```text
Inputs      10–12px
Buttons     10–12px
Cards       14–16px
Panels      16–20px
```

Do not make every component a 24–32px pill.

---

# 28. Motion

Allowed:
- subtle page/section fade
- dialog/sheet transitions
- hover
- toast
- list update

Avoid:
- parallax
- floating cards
- constant spring animation
- animated numbers everywhere

---

# 29. Loading

Prefer content-shaped skeletons.

Avoid full-screen spinner unless necessary.

---

# 30. Errors

Use human-readable Thai.

Examples:
```text
บันทึกรายการไม่สำเร็จ
กรุณาลองอีกครั้ง
```

```text
เลือกบัญชีต้นทางและปลายทางคนละบัญชี
```

Never show raw Supabase/Postgres errors.

---

# 31. Destructive Confirmations

Confirm:
- delete transaction
- archive account
- destructive settings action
- deleting a category in use

Do not confirm normal save/navigation/filter actions.

---

# 32. Responsive Behavior

Below 768px:
- hide desktop sidebar
- show bottom nav
- single column
- filters in sheet/drawer where useful
- safe-area padding
- compact chart height
- no desktop tables

768px and above:
- sidebar
- wider layouts
- compact multi-column summaries

---

# 33. Accessibility

Required:
- input labels
- visible focus states
- keyboard navigation
- 44px touch target mobile
- good contrast
- no color-only meaning
- accessible dialog focus behavior
- visible validation text

---

# 34. Money Formatting

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

Do not change underlying financial precision.

---

# 35. Date Formatting

Thai-first display:
```text
14 ก.ย. 2569
วันนี้ 12:42
เมื่อวาน 18:15
```

Do not change underlying date storage semantics.

---

# 36. Routes in Scope

Redesign:
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

Optional UI concept:
```text
/contacts
```

Only add it if safe.

---

# 37. What Must Not Change

Do not:
- replace Supabase
- rewrite database schema without necessity
- rewrite finance calculations
- change transaction meanings
- weaken RLS
- remove tests
- implement Tax
- implement Slip/OCR
- implement AI Assistant
- add bank credentials
- add direct bank integration
- add payment processing

---

# 38. What May Change

Allowed:
- layout
- typography
- spacing
- labels
- icons
- visual hierarchy
- responsive behavior
- cards
- empty states
- toolbar UX
- navigation presentation
- transaction list presentation
- account presentation
- contacts navigation
- settings grouping

---

# 39. Design Tokens

Use semantic tokens such as:
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

Dark mode is not required in V2.

---

# 40. Testing & Verification

Before delivery:
```text
[ ] npm run lint
[ ] npm run typecheck
[ ] npm test
[ ] npm run build
[ ] Playwright desktop passes
[ ] Playwright iPhone passes
[ ] income totals unchanged
[ ] expense totals unchanged
[ ] transfers remain excluded
[ ] account balances reconcile
[ ] no sensitive credential fields added
[ ] no full card/CVV/PIN/OTP fields added
```

Test visual widths:
```text
390
430
768
1024
1440
```

---

# 41. UX Success Criteria

V2 succeeds when:
- Today is understandable in under 5 seconds
- Add Transaction feels fast
- income/expense/transfer are immediately distinguishable
- mobile feels native-like
- desktop feels focused
- UI no longer looks like ERP/admin template
- Thai typography feels intentional
- empty states are compact
- existing finance logic remains correct

---

# 42. Final Principle

Do not make Finn look modern by adding more decoration.

Make it modern through:

- hierarchy
- typography
- whitespace
- clarity
- density
- interaction speed
- consistency

Final target:

> A calm, modern personal finance product that feels trustworthy enough to use every day.
