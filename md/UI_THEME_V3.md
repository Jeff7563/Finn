# UI_THEME_V3.md
# Finn — Adaptive Theme System v3

> Scope: visual theme upgrade only
> Approved layout: keep current layout and responsive structure
> Themes: Soft Gradient Light + Premium Dark + System
> Primary target: iPhone 11 Pro Max and responsive desktop
> Do not change finance logic, routes, database schema, auth, RLS, security controls, or calendar calculations.

---

## 1. Goal

Upgrade Finn visually without redesigning its information architecture.

Finn must support:

```text
Light  = Soft Gradient
Dark   = Premium Dark
System = Follow OS preference
```

The result should feel more premium, polished, and modern while still looking like a finance product rather than an AI dashboard.

---

## 2. Theme Modes

Use:

```ts
type ThemeMode = "system" | "light" | "dark";
```

Default:

```text
system
```

Behavior:

- `system`: follow `prefers-color-scheme`
- `light`: force Soft Gradient Light
- `dark`: force Premium Dark

Persist the preference across reloads.

Recommended local key:

```text
finn-theme
```

Do not add a database migration only for theme preference unless the project already has an appropriate profile preference field.

---

## 3. Settings Control

Add to `/settings`:

```text
การแสดงผล

[ ตามระบบ ] [ สว่าง ] [ มืด ]
```

Use a compact segmented control.

Optional header shortcut:

```text
☀︎ / ☾
```

Only add the shortcut if it does not clutter the existing mobile or desktop header.

---

## 4. Theme Architecture

Use semantic CSS variables or equivalent design tokens.

Minimum:

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

Components should consume semantic tokens instead of hardcoded colors.

Do not implement dark mode by patching random class names one by one.

---

## 5. Soft Gradient Light

Direction:

- airy
- clean
- soft lavender/blue accents
- white cards
- subtle depth
- premium consumer-finance feel

Suggested palette direction:

```text
Background       #F7F8FC
Background Soft  #F2F4FA
Surface          #FFFFFF
Surface Soft     #F7F7FB
Text Primary     #0F172A
Text Secondary   #475569
Text Muted       #94A3B8
Border           #E7EAF1

Primary          Indigo / Violet
Income           Emerald
Expense          Rose / Red
Transfer         Blue
Warning          Amber
```

### Gradient rule

Use gradients only in selected areas:

- main balance hero
- selected/active highlight
- calendar selected day
- small decorative accents

Do NOT use gradients on every card or button.

Preferred hero:

```text
very pale lavender → pale sky blue → white
```

---

## 6. Premium Dark

Direction:

- deep navy
- charcoal-blue surfaces
- high contrast
- premium banking feel
- calm semantic colors
- no neon

Suggested palette direction:

```text
Background       #08111F
Background Soft  #0D1726
Surface          #101B2B
Surface Raised   #142133
Surface Soft     #182639
Text Primary     #F8FAFC
Text Secondary   #CBD5E1
Text Muted       #7F8DA3
Border           #223149

Primary          Teal / Emerald
Income           Emerald
Expense          Coral Red
Transfer         Bright Blue
Warning          Amber
```

Do not use pure black for the entire UI.

Do not use glassmorphism or cyberpunk glow.

---

## 7. Shared Typography

Keep:

```text
Geist
Noto Sans Thai
Inter
system-ui
```

Hierarchy:

```text
Page title        28–32px
Hero money        40–48px
Section title     18–20px
Body              14–16px
Metadata          12–13px
```

Financial values should use tabular numerals where possible.

---

## 8. Today Page

Keep the current layout.

### Light

Upgrade the balance area to a subtle gradient hero:

```text
ยอดเงินทั้งหมด
฿149,222.00
+฿29,222 เดือนนี้
```

Use lavender/blue ambient color, but keep text highly readable.

Quick actions:
- Expense: soft rose
- Income: soft emerald
- Transfer: soft blue

Recent transaction rows:
- cleaner surface
- stronger amount alignment
- subtle hover/tap state

### Dark

Hero:
- deep navy surface
- subtle teal/blue ambient highlight
- white balance
- green delta

Quick actions:
- muted semantic surfaces
- no glowing buttons

---

## 9. Overview Page

Keep current layout and Calendar Insights placement.

### Light

Improve:
- cash-flow hero
- total balance card
- chart fills
- spending bars
- calendar surface
- account cards

Use soft gradient only where it increases hierarchy.

### Dark

Use:
- raised navy cards
- emerald income
- coral expense
- teal/blue calendar
- stronger card separation

Calendar should become one of the most visually attractive sections in dark mode.

---

## 10. Calendar Theme

### Light Heatmap

```text
0 = neutral
1 = pale lavender
2 = soft violet
3 = medium violet
4 = stronger violet
```

Income marker:
```text
green
```

Transfer marker:
```text
blue
```

Selected:
```text
violet outline + soft fill
```

### Dark Heatmap

```text
0 = dark muted
1 = deep teal
2 = medium teal
3 = bright teal
4 = emerald-teal
```

Selected:
```text
bright teal outline
```

Do not use intense red heatmap blocks.

---

## 11. Charts

Theme charts consistently.

### Light
- income: green / blue-green
- expense: soft rose/red
- grid: light neutral

### Dark
- income: emerald/teal
- expense: coral-red
- grid: muted blue-gray

No bright white grid lines.

---

## 12. Sidebar

Keep layout.

### Light
- white/near-white
- soft active state
- selected icon + label use primary
- subtle hover surface

### Dark
- sidebar slightly darker than page
- active row on raised muted surface
- muted icons by default
- selected text clear and bright

No full-sidebar gradient.

---

## 13. Mobile Header

Keep structure.

### Light
- white or very soft surface
- subtle divider
- clean circular action buttons

### Dark
- deep surface
- subtle bottom border
- high contrast icons

---

## 14. Mobile Bottom Navigation

Keep:

```text
วันนี้
รายการ
+
ภาพรวม
เพิ่มเติม
```

### Light
- white
- subtle top border
- dark center add button
- active accent

### Dark
- deep navy
- active item teal/white
- center add button can be white or teal depending contrast

No glow.

---

## 15. Add Transaction

Keep the current form layout and field order.

Theme:
- segmented control
- amount input
- selects
- date input
- sticky save area
- validation

must adapt to both themes.

The amount field should feel like the visual focus.

---

## 16. Accounts

Keep wallet-card layout.

### Light
- soft white card
- subtle accent strip or small gradient detail
- dominant balance

### Dark
- raised navy card
- small accent line/icon
- strong balance contrast
- masked number muted

Never expose more account data for design purposes.

---

## 17. Contacts

Keep layout.

Improve:
- avatar surface
- search input
- tab state
- hover/tap feedback
- amount hierarchy

No external merchant logos.

---

## 18. Categories

Keep layout.

Theme category tiles consistently.

Avoid giving every category a strong unique color.

Use:
- neutral tile
- subtle icon bubble
- selected/hover state

---

## 19. Settings

Keep current grouping.

Add:

```text
การแสดงผล
[ ตามระบบ ] [ สว่าง ] [ มืด ]
```

Security wording and developer tools must remain intact.

---

## 20. Inputs

### Light
- white
- subtle border
- soft primary focus ring

### Dark
- surface-soft
- muted border
- bright text
- teal/blue focus state

Placeholder text must remain readable.

---

## 21. Buttons

Primary:

Light:
```text
deep navy / indigo
white label
```

Dark:
```text
teal/emerald or bright neutral
high contrast label
```

Secondary:
- theme surface
- subtle border

Destructive:
- semantic red

No gradients on every button.

---

## 22. Segmented Controls

Examples:

```text
รายจ่าย | รายรับ | โอน
Heatmap | Calendar
```

Light:
- pale track
- selected white or pale-primary

Dark:
- dark track
- selected raised/primary surface

Selected state must be obvious.

---

## 23. Sheets and Dialogs

### Light
- white
- subtle shadow
- rounded top corners on mobile

### Dark
- raised navy surface
- border
- darker overlay

Do not hardcode white modal backgrounds.

---

## 24. Shadows and Borders

Light:
- soft low-opacity shadows

Dark:
- rely more on border + surface contrast
- minimal shadows

Do not over-border every component.

---

## 25. Radius

Keep current moderate radius:

```text
Inputs     10–12px
Buttons    10–12px
Cards      14–16px
Hero       18–20px
Sheet      20–24px top
```

---

## 26. Responsive Requirements

Approved mobile structure must stay.

Test:

```text
390px
414px
430px
768px
1024px
1440px
```

Verify:
- no horizontal overflow
- safe-area works
- gradients do not crop awkwardly
- long Thai labels wrap correctly
- amount values never overflow
- calendar remains readable
- dark contrast remains strong
- bottom navigation works

---

## 27. Mobile Light Target

Feel:

```text
soft
bright
premium
friendly
clean
```

Use subtle gradient hierarchy, not decoration overload.

---

## 28. Mobile Dark Target

Feel:

```text
premium banking
night-friendly
focused
deep
high contrast
```

The Calendar and finance values should stand out clearly.

---

## 29. Theme Transitions

Allowed:

```text
background-color
color
border-color
```

Duration:

```text
150–250ms
```

Respect:

```text
prefers-reduced-motion
```

No dramatic animations.

---

## 30. Flash Prevention

Avoid a light flash before dark mode loads.

Apply the resolved theme before first meaningful paint where practical.

This is important on mobile.

---

## 31. Accessibility

Both themes must preserve:

- sufficient text contrast
- visible focus
- semantic finance colors
- non-color-only meaning
- readable muted text
- clear disabled states

Aesthetic dark mode must not reduce usability.

---

## 32. Security Constraints

Theme work must not change:

- auth
- RLS
- secrets
- account masking
- demo security
- authorization rules

Do not expose additional sensitive information.

---

## 33. Finance Constraints

Theme work must not change:

- balances
- transactions
- transfer isolation
- calendar calculations
- currency calculation behavior

This is presentation only.

---

## 34. Routes in Scope

Theme all current routes:

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

Future routes should automatically inherit theme tokens.

---

## 35. Visual QA

Check both themes for:

### Light
- gradient hero subtle
- cards readable
- calendar readable
- chart colors clean
- no gradient overload

### Dark
- no pure-black overload
- no neon
- clear surface hierarchy
- chart readable
- calendar readable
- finance numbers high contrast
- muted copy still legible

---

## 36. Final Principle

The themes must feel like the same Finn product.

Shared:
- layout
- spacing
- typography
- radius
- components
- interaction

Different:
- palette
- surface depth
- gradient treatment
- chart/calendar colors

Final target:

> Light = soft, dimensional, premium.  
> Dark = deep, elegant, focused.
