# Tax Engine Module (Phase 4)

This directory is reserved for Phase 4 implementation of versioned personal income tax (PIT) calculations according to Thailand Revenue Department guidelines.

## Planned Architecture:
- `rules/`: Versioned tax laws by year (e.g. 2026, 2027) with brackets, allowable expense deductions, and personal allowances
- `calculator.ts`: Deterministic calculation of net taxable income, progressive brackets, withholding tax offsets, and tax reserves
- `deductions.ts`: Deduction tracking (SSF, provident funds, RMF/SSF/ThaiESG, life insurance, home loan interest, etc.)
- `disclaimer.ts`: Legal compliance reminders (estimates only, not formal tax filings)
