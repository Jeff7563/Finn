# PROMPT_UI_THEME_V3.md
# Agent Prompt — Implement Finn Adaptive Theme v3

You are a senior frontend engineer and product designer working on the existing Finn Personal Finance OS.

Use:

- `UI_THEME_V3.md`
- `PRODUCT_SPEC.md`
- `UI_SPEC_V2.md`
- `OVERVIEW_CALENDAR_ADDON.md`

The current layout is approved.

This task is a VISUAL THEME UPGRADE, not another redesign.

---

## Primary Task

Implement:

```text
Soft Gradient Light
Premium Dark
System Theme
```

Theme modes:

```ts
"system" | "light" | "dark"
```

Default:

```text
system
```

---

## Non-Negotiable

Do NOT:
- change page layout
- change navigation architecture
- rewrite finance logic
- alter balances
- alter transfer rules
- alter calendar aggregation
- alter auth
- weaken RLS
- alter security controls
- add database schema only for themes
- remove existing tests

---

## 1. Inspect First

Before editing:
1. inspect `globals.css`
2. inspect Tailwind config
3. inspect app layouts
4. inspect Sidebar
5. inspect MobileBottomNav
6. inspect Today
7. inspect Overview
8. inspect Calendar components
9. inspect Transaction form
10. inspect Accounts
11. inspect Settings
12. find hardcoded colors

Do not blindly replace components.

---

## 2. Add Semantic Tokens

Create/refine theme tokens:

```css
--bg;
--bg-subtle;
--surface;
--surface-raised;
--surface-soft;
--surface-muted;
--text-primary;
--text-secondary;
--text-muted;
--border;
--border-strong;
--primary;
--primary-hover;
--primary-soft;
--income;
--income-soft;
--expense;
--expense-soft;
--transfer;
--transfer-soft;
--warning;
--warning-soft;
--shadow-sm;
--shadow-md;
--shadow-lg;
--gradient-hero;
--gradient-accent;
```

Refactor components to use semantic tokens.

Avoid random hardcoded colors.

---

## 3. Implement Light Theme

Follow `UI_THEME_V3.md`.

Key characteristics:
- soft near-white background
- white surfaces
- lavender/indigo primary
- subtle lavender-blue hero gradient
- emerald income
- rose/red expense
- blue transfer

Use gradients only strategically.

---

## 4. Implement Dark Theme

Follow `UI_THEME_V3.md`.

Key characteristics:
- deep navy background
- layered charcoal-blue surfaces
- emerald/teal primary
- coral expense
- blue transfer
- high contrast text

Avoid:
- pure black everywhere
- neon
- glow
- glassmorphism

---

## 5. Theme Provider

Implement robust theme resolution:

```text
system
light
dark
```

Persist selection.

Recommended:

```text
localStorage key = finn-theme
```

Use `prefers-color-scheme` for system.

Avoid hydration mismatch and light flash in dark mode.

If the project already has a theme system, extend it.

---

## 6. Settings Theme Control

Add:

```text
การแสดงผล
[ ตามระบบ ] [ สว่าง ] [ มืด ]
```

Use compact segmented control.

Do not redesign Settings.

---

## 7. Today

Keep layout.

Light:
- soft gradient hero
- semantic quick actions
- polished recent rows

Dark:
- deep hero
- white balance
- emerald delta
- muted semantic action surfaces

---

## 8. Overview

Keep layout.

Theme:
- cash flow cards
- total balance
- charts
- category bars
- calendar
- accounts

Dark Calendar Heatmap should be visually strong but not neon.

---

## 9. Calendar

Light heatmap:
```text
neutral → lavender → violet
```

Dark heatmap:
```text
muted navy → teal → emerald-teal
```

Income marker:
```text
green
```

Transfer:
```text
blue
```

Selected day must remain obvious.

---

## 10. Transactions

Theme existing:
- search
- filter pills
- rows
- amount colors
- empty state

Do not change grouping or logic.

---

## 11. Add Transaction

Theme existing:
- type selector
- amount input
- account/category inputs
- date
- sticky action
- validation

Do not alter field order.

---

## 12. Accounts

Keep wallet-card layout.

Light:
- subtle accent or gradient detail

Dark:
- raised navy card
- strong balance
- muted identifier

Do not expose more account information.

---

## 13. Contacts / Categories

Theme current components.

Do not introduce external logos or excessive colors.

---

## 14. Mobile Navigation

Keep:

```text
วันนี้
รายการ
+
ภาพรวม
เพิ่มเติม
```

Light:
- white bottom bar
- dark center add button

Dark:
- deep bottom bar
- teal/white active state
- high-contrast center action

No glow.

---

## 15. Sheets / Dialogs

Make all overlays theme-aware.

No hardcoded white dialogs.

Check mobile More sheet, filters, daily calendar sheet, transaction editors, and confirmations.

---

## 16. Responsive QA

Test:

```text
390
414
430
768
1024
1440
```

Check:
- no horizontal overflow
- safe area
- Thai wrapping
- calendar
- amounts
- form controls
- hero gradients
- dark contrast

---

## 17. Accessibility

Verify:
- text contrast
- focus states
- disabled state
- semantic colors
- dark muted text readability

Do not rely only on color.

---

## 18. Theme Transition

Use subtle transition only:

```text
150–250ms
```

Respect `prefers-reduced-motion`.

---

## 19. Do Not Touch Security

Do not alter:
- auth
- RLS
- Supabase secrets
- demo access
- ownership validation
- account masking

If you notice a security issue, report it separately.

---

## 20. Do Not Touch Finance Logic

No calculation changes.

Avoid editing `src/lib/finance/*` except harmless imports/formatters when truly required.

---

## 21. Tests

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test
```

All current tests must pass.

Add theme-focused tests where practical:
- theme preference persists
- system theme resolves
- dark/light attribute/class applies
- Settings selector changes theme

---

## 22. Visual QA

Inspect every major route in BOTH themes.

At minimum:

```text
/today
/overview
/transactions
/transactions/new
/accounts
/categories
/settings
```

at:

```text
430px
1440px
```

---

## Deliverable

Report:

1. files changed
2. theme architecture
3. persistence method
4. system mode behavior
5. semantic token list
6. light theme changes
7. dark theme changes
8. responsive QA
9. accessibility QA
10. test/build results

Do not claim completion if either theme contains unreadable, broken, or obviously unthemed screens.

---

## Final Rule

Do not redesign Finn.

Polish Finn.

The layout is already approved.

Make it feel:

```text
Light → soft, premium, dimensional
Dark  → deep, elegant, focused
```

without sacrificing responsiveness, finance correctness, or security.
