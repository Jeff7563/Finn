# OVERVIEW_CALENDAR_ADDON.md
# Finn — Overview Calendar Add-on Specification

> Product: Finn — Personal Finance OS  
> Scope: Additive feature for `/overview`  
> Status: Ready for implementation  
> Important: Do not remove, replace, or rewrite the existing Overview sections. This feature must be added on top of the current V2 UI and must preserve all existing finance rules, routes, tests, RLS, and deterministic calculations.

---

## 1. Objective

Add a modern calendar-based financial visualization to `/overview` so the user can understand daily money activity at a glance.

This should complement the current Overview, not replace it.

Primary goals:
1. See which days had high spending.
2. See which days had income, expense, or transfers.
3. Inspect one specific day quickly.
4. Navigate month-by-month.
5. Jump from a day to that day's filtered transactions.
6. Keep the existing Overview layout and calculations intact.

The feature should feel modern, compact, and useful rather than decorative.

---

## 2. Feature Name

User-facing Thai title:

```text
ภาพรวมตามปฏิทิน
```

English/internal component name:

```text
Calendar Insights
```

---

## 3. Placement

Add the new section inside `/overview`.

Preferred placement:

```text
Existing monthly cash-flow summary
↓
Existing 6-month trend / spending overview
↓
NEW: ภาพรวมตามปฏิทิน
↓
Existing accounts snapshot
↓
Existing people / merchant insights
```

If the current layout works better with the section before the account snapshot, place it there.

Do not remove or reorder existing sections unnecessarily.

---

## 4. Modes

The section must contain two user-selectable modes:

```text
Heatmap
Calendar
```

Default:

```text
Heatmap
```

Use a compact segmented control.

Do not create two separate routes.

Both modes must reuse the same daily summary data.

---

## 5. Month Navigation

Header example:

```text
ภาพรวมตามปฏิทิน

‹      กันยายน 2569      ›
```

Controls:
- previous month
- next month
- optional `เดือนนี้` button when viewing another month

Month selection is local to this section.

---

## 6. Data Source

Use existing `transactions`.

Do not add duplicate financial truth tables.

All calendar values must be derived from existing transaction data.

Important:

```text
transactions remain the source of truth
```

---

## 7. Daily Financial Summary Model

Create a reusable daily summary structure.

Suggested:

```ts
type DailyFinancialSummary = {
  date: string;
  income: number;
  expense: number;
  transfer: number;
  transactionCount: number;
  incomeCount: number;
  expenseCount: number;
  transferCount: number;
  topExpenseCategory?: {
    id?: string;
    name: string;
    amount: number;
  };
};
```

Exact typing may follow the current project conventions.

---

## 8. Transaction Classification Rules

Daily totals must follow current Finn transaction semantics.

### Income
Count only transactions that currently count as income.

### Expense
Count only transactions that currently count as expense.

### Transfer
Transfers between owned accounts:
- may be shown as calendar activity
- must be counted separately
- must NOT increase income
- must NOT increase expense
- must NOT affect net cash flow

Preserve existing transfer isolation logic.

Do not duplicate or reimplement transfer rules differently from the finance layer.

---

## 9. Heatmap Mode

Heatmap is the default view.

Each cell represents one date.

Primary visual meaning:

```text
cell intensity = total expense amount for that day
```

No expense:
- very light / neutral cell

Low expense:
- light semantic expense tint

High expense:
- stronger semantic expense tint

Avoid highly saturated red blocks. Keep the visual calm.

---

## 10. Heatmap Intensity Calculation

Do NOT use one fixed baht threshold for every user.

Preferred normalization:
1. Collect daily expense totals for the visible month.
2. Ignore zero-expense days when calculating scale.
3. Determine a robust monthly maximum.
4. Map each day's expense into 4–5 visual intensity levels.

Recommended levels:

```text
Level 0 = no expense
Level 1 = low
Level 2 = medium-low
Level 3 = medium-high
Level 4 = high
```

A percentile or relative monthly scale is preferred.

The helper must be deterministic and unit-testable.

---

## 11. Heatmap Legend

Show a compact legend.

Example:

```text
ใช้จ่ายน้อย  ▫ ▫ ▫ ▫ ▪  ใช้จ่ายมาก
```

If indicators are used, explain them subtly:

```text
● รายรับ
● โอน
```

Because expense is already encoded in intensity, avoid redundant expense markers unless needed.

---

## 12. Activity Indicators

Recommended pattern:
- cell background intensity = expense
- small green dot = income exists
- small blue dot = transfer exists

Do not create too much visual noise.

---

## 13. Heatmap Layout

Desktop:
- 7 columns
- weekday labels
- full visible month
- clickable cells
- visible date number

Thai weekday labels may use:

```text
จ
อ
พ
พฤ
ศ
ส
อา
```

Preferred week start:

```text
Monday-first
```

unless the current app strongly standardizes otherwise.

---

## 14. Calendar Mode

Calendar mode displays a traditional monthly financial calendar.

Each cell may show:
- date number
- income amount if any
- expense amount if any
- transaction count if useful

Example desktop cell:

```text
14

+฿15,000
-฿389

3 รายการ
```

Do not display every transaction inside the cell.

---

## 15. Calendar Cell Priority

Priority:
1. Date
2. Expense / income summary
3. Activity count

On mobile, reduce detail.

Example mobile:

```text
14
-389
+15k
```

or date + semantic indicators only.

Full detail belongs in the daily sheet.

---

## 16. Mobile Calendar Behavior

Primary target:

```text
iPhone 11 Pro Max
```

Requirements:
- tappable cells
- no page-level horizontal overflow
- readable month header
- reduced content density
- bottom sheet for daily details

Prefer a readable 7-column layout without horizontal scrolling.

If scrolling is needed, confine it to the calendar region only.

---

## 17. Day Interaction

Clicking or tapping a date opens a daily summary.

Desktop:
- popover, side panel, or dialog

Mobile:
- bottom sheet

Preferred shared component:

```text
DaySummarySheet
```

---

## 18. Day Summary Content

Example:

```text
14 กันยายน 2569

รายรับ
+฿15,000

รายจ่าย
-฿389

โอนเงิน
฿4,000

3 รายการ

ใช้จ่ายมากที่สุด
อาหาร · ฿389

[ ดูรายการวันนี้ ]
```

If no activity:

```text
14 กันยายน 2569

ยังไม่มีรายการในวันนี้

[ + เพิ่มรายการ ]
```

---

## 19. Day Summary Transactions Preview

Optional but recommended.

Show up to 3 transactions:

```text
7-Eleven                         -฿82
Consulting Fee               +฿15,000
โอนระหว่างบัญชี                ฿4,000
```

Then:

```text
ดูทั้งหมด 3 รายการ
```

Do not overload the sheet.

---

## 20. View Transactions for Selected Day

The action:

```text
ดูรายการวันนี้
```

should navigate to `/transactions` with the selected date applied.

Preferred:

```text
/transactions?date=2026-09-14
```

or reuse the existing date filter mechanism if one already exists.

A date in the URL is acceptable.

---

## 21. Add Transaction from Calendar

When a selected day has no transactions, offer:

```text
+ เพิ่มรายการ
```

If technically straightforward, prefill the date:

```text
/transactions/new?date=2026-09-14
```

Only do this if the current form supports it safely.

Do not build fragile state plumbing solely for this feature.

---

## 22. Top Expense Category

Optionally calculate the highest-spend expense category for the selected day.

Example:

```text
อาหาร · ฿389
```

If uncategorized:

```text
ยังไม่จัดหมวดหมู่
```

Do not invent categories.

---

## 23. Compact Month Summary

Optional enhancement:

```text
กันยายน 2569

รายรับ       +฿30,000
รายจ่าย      -฿778
เคลื่อนไหว     6 รายการ
```

Keep compact.

Do not duplicate the large Overview hero metrics.

---

## 24. Empty State

If the selected month has no transaction data:

```text
ยังไม่มีข้อมูลสำหรับปฏิทิน

เมื่อคุณเริ่มบันทึกรายการ
ระบบจะแสดงภาพรวมรายวันให้ที่นี่

[ + เพิ่มรายการ ]
```

Do not show a meaningless zero-heavy chart.

---

## 25. Loading State

Use a calendar-shaped skeleton.

Keep the rest of the Overview visible.

Avoid full-screen loading spinners.

---

## 26. Error State

Example:

```text
โหลดข้อมูลปฏิทินไม่สำเร็จ
กรุณาลองอีกครั้ง

[ ลองใหม่ ]
```

Never show raw database or API errors.

---

## 27. Accessibility

Requirements:
- interactive day cells use button semantics
- keyboard focusable
- visible focus state
- accessible labels include date and summary

Example:

```text
14 กันยายน 2569, รายรับ 15,000 บาท, รายจ่าย 389 บาท, 3 รายการ
```

Do not rely on color alone.

---

## 28. Localization

Thai-first presentation:

```text
14 ก.ย. 2569
กันยายน 2569
วันนี้
```

Important:
- underlying database dates remain Gregorian / ISO
- do not store Buddhist Era years in the database
- convert only for display

---

## 29. Number Formatting

Reuse Finn's existing money formatter.

Examples:

```text
+฿15,000
-฿389
฿4,000
```

Do not create a separate inconsistent formatter.

---

## 30. Component Architecture

Recommended:

```text
src/components/overview/
├── OverviewCalendarSection.tsx
├── CalendarModeToggle.tsx
├── FinanceHeatmap.tsx
├── FinanceMonthCalendar.tsx
├── CalendarDayCell.tsx
├── DaySummarySheet.tsx
└── CalendarLegend.tsx
```

Exact naming may follow current repository conventions.

---

## 31. Finance Utility Architecture

Recommended:

```text
src/lib/finance/calendar.ts
```

Possible functions:

```ts
groupTransactionsByDay()
getDailyFinancialSummaries()
getMonthCalendarMatrix()
getExpenseHeatmapIntensity()
getTopExpenseCategoryForDay()
```

Prefer pure deterministic functions.

---

## 32. Business Logic Separation

Do not scatter calculations inside JSX.

Bad:

```tsx
transactions.filter(...).reduce(...)
```

inside multiple components.

Preferred:

```ts
const dailySummaries = getDailyFinancialSummaries(...)
```

UI consumes structured data.

---

## 33. Database Changes

No database schema change should be required.

Do NOT add:
- `calendar_days`
- duplicated daily summary tables

Compute from existing transactions.

Caching can be considered only if future performance requires it.

---

## 34. Performance

For month view:
- query/aggregate only the visible month's transactions
- include only minimal boundary days needed for grid rendering

Do not fetch the user's full history just to render one month.

Preserve compatibility with demo/in-memory data if the current project uses it.

---

## 35. Timezone Safety

Finn uses:

```text
Asia/Bangkok
```

Group transactions by the user's intended local date.

Avoid UTC bugs where:

```text
14 Sep → grouped as 13 Sep
```

Reuse current timezone/date utilities where possible.

---

## 36. Adjacent Month Dates

The monthly grid may show leading/trailing adjacent-month dates.

Recommended:
- muted
- non-interactive for first implementation
- navigate months using arrows

Keep behavior simple and predictable.

---

## 37. Today Highlight

If today is visible, use a subtle indicator.

Example:
- outlined date circle

Do not use a loud accent.

---

## 38. Selected Day State

Selected day should use:
- clear outline
- subtle active state
- separate visible keyboard focus

Do not rely on color alone.

---

## 39. Heatmap Scale

Recommended:

```text
5 visual states total
```

Including no-expense state.

Use existing Finn semantic tokens.

Do not introduce a new unrelated palette.

---

## 40. Transfer Visualization

Transfers are shown separately.

Example:

```text
โอนเงิน
฿4,000
```

Do not prefix transfer with `+` or `-`.

Do not count transfer toward expense heat intensity.

---

## 41. Net Calculation

Correct:

```text
dailyNet = dailyIncome - dailyExpense
```

Incorrect:

```text
dailyIncome - dailyExpense - transfer
```

Transfers remain excluded.

---

## 42. Month Summary Rules

If month summary is shown:

```text
monthlyIncome = sum(income)
monthlyExpense = sum(expense)
monthlyNet = monthlyIncome - monthlyExpense
monthlyTransfer = sum(transfer) // separate
```

---

## 43. Current Overview Compatibility

The current Overview already contains:
- net cash flow
- total balance
- 6-month trend
- top expense categories
- accounts
- people insights

Calendar Insights should add only:

```text
daily time-based pattern
```

Do not duplicate all current modules inside it.

---

## 44. Interaction Examples

### Expense-only day

```text
15 ก.ย.

รายจ่าย -฿620
2 รายการ
```

### Income + expense day

```text
20 ก.ย.

รายรับ +฿8,000
รายจ่าย -฿120
2 รายการ
```

### Transfer-only day

```text
21 ก.ย.

โอนเงิน ฿5,000
1 รายการ
```

Expense intensity remains zero for transfer-only days.

---

## 45. Mobile Daily Sheet Example

```text
14 กันยายน 2569

+฿15,000 รายรับ
-฿389 รายจ่าย
 ฿4,000 โอนเงิน

3 รายการ

Weekly Groceries          -฿389
Consulting Fee         +฿15,000
โอนระหว่างบัญชี          ฿4,000

[ ดูรายการวันนี้ ]
```

Respect safe-area inset.

---

## 46. Desktop Daily Detail

Desktop may use:
- anchored popover
- compact dialog
- right-side sheet

Choose what best matches the current Finn component system.

---

## 47. Visual Style

Must match Finn V2:
- sans-serif
- Thai-first
- calm neutrals
- restrained semantic colors
- subtle borders
- moderate radius
- no glow
- no gradients
- no glassmorphism
- no dashboard gimmicks

---

## 48. Unit Tests

Add tests for:

1. income grouped to correct day
2. expense grouped to correct day
3. transfer grouped separately
4. transfer excluded from net
5. multiple transactions same day aggregate correctly
6. top expense category
7. zero-data day
8. month boundary
9. timezone/date grouping where applicable
10. heatmap intensity returns stable levels

---

## 49. UI / Integration Tests

Verify:
- existing Overview still renders
- Calendar Insights exists
- default mode = Heatmap
- toggle switches to Calendar
- previous month works
- next month works
- clicking a day opens detail
- daily totals are correct
- `ดูรายการวันนี้` works
- no-data month has empty state
- transfer-only day is not shown as expense

---

## 50. Mobile E2E

Add at least one iPhone-size flow:

1. open `/overview`
2. scroll to Calendar Insights
3. tap a day
4. verify bottom sheet
5. close it
6. switch to Calendar mode
7. verify no horizontal overflow

---

## 51. Regression Requirements

After implementation run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test
```

All existing tests must continue to pass.

Do not delete tests to force success.

---

## 52. Files Likely to Change

Expected:

```text
src/app/(dashboard)/overview/page.tsx
src/components/overview/*
src/lib/finance/calendar.ts
tests/finance/calendar.test.ts
e2e/*
```

Potential:

```text
src/lib/finance/formatters.ts
```

Avoid touching:
- Supabase migrations
- RLS policies
- transaction schema
- transfer semantics
- balance logic

unless genuinely necessary.

---

## 53. Implementation Sequence

1. inspect current Overview
2. inspect transaction data shape
3. create pure calendar aggregation helpers
4. unit-test helpers
5. build shared day cell
6. build Heatmap mode
7. build Calendar mode
8. build Day Summary sheet
9. integrate into Overview
10. connect selected-date transaction filter
11. responsive QA
12. full regression test

---

## 54. Agent Guardrails

The agent MUST NOT:
- redesign the entire Overview
- remove current sections
- modify finance source-of-truth behavior
- create fake production calendar data
- count transfers as income/expense
- add a new calendar summary database table
- implement Tax
- implement Slip OCR
- implement AI features
- introduce a major UI framework solely for this feature
- add heavy dependencies without justification

---

## 55. Dependency Guidance

Prefer a lightweight custom implementation using the current stack.

A large calendar library is not necessary for:
- a monthly grid
- a heatmap
- month navigation
- day details

If a new package is used:
- justify it
- check bundle impact
- confirm mobile behavior
- confirm accessibility

---

## 56. Success Criteria

The feature succeeds when:
- spending-heavy days are obvious in seconds
- income days are visible
- transfers are visible but financially isolated
- selecting a day gives useful detail
- the feature looks native to Finn V2
- Overview remains clean
- mobile remains easy to use
- all existing finance tests still pass

---

## 57. Final Principle

This calendar is not decoration.

It should answer:

> “เงินของฉันเคลื่อนไหววันไหน และวันไหนฉันใช้เงินหนักที่สุด?”

If it does not make that easier to understand, simplify it.
