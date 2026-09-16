import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  calculateAccountBalance,
  calculateAllAccountBalances,
  calculateTotalActiveBalance,
  doesTransactionAffectAccountBalance,
} from "@/lib/finance/balances";
import {
  calculateCategorySummaries,
  calculateMonthSummary,
} from "@/lib/finance/summaries";
import {
  bangkokDateTimeLocalToCanonicalInstant,
  canonicalInstantToBangkokDateTimeLocal,
  parseStrictBaselineInstant,
} from "@/lib/finance/formatters";
import { accountSchema } from "@/lib/validation/schemas";
import { Account, Category, Transaction } from "@/types/finance";
import { MemoryDataStore } from "@/lib/server/memory-data-store";
import {
  createAccountAction,
  updateAccountAction,
} from "@/app/actions/accounts";

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock auth
const testUser = { id: "user-1", email: "user@test.local" };
vi.mock("@/lib/server/auth", () => ({
  requireUser: vi.fn(async () => testUser),
  getAuthenticatedUser: vi.fn(async () => testUser),
}));

describe("Finn — Balance Baseline / As-Of Balance Architecture (22 Required Scenarios)", () => {
  // Helper to construct sample accounts
  const createTestAccount = (overrides: Partial<Account> = {}): Account => ({
    id: "acc-1",
    user_id: "user-1",
    name: "MAKE by KBank",
    type: "bank",
    institution: "KBANK",
    currency: "THB",
    opening_balance: 1000,
    balance_as_of: null,
    active: true,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  });

  // Helper to construct sample transactions
  const createTestTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
    id: "tx-1",
    user_id: "user-1",
    type: "expense",
    amount: 100,
    from_account_id: "acc-1",
    to_account_id: null,
    currency: "THB",
    transaction_date: "2026-09-16T12:00:00Z",
    source: "manual",
    confidence: 1,
    review_status: "confirmed",
    tax_deductible: false,
    created_at: "2026-09-16T12:00:00Z",
    updated_at: "2026-09-16T12:00:00Z",
    ...overrides,
  });

  // 1. Legacy account without balance_as_of preserves traditional balance calculation
  it("Scenario 1: Legacy account without balance_as_of preserves traditional balance calculation", () => {
    const account = createTestAccount({
      opening_balance: 1000,
      balance_as_of: null,
    });
    const transactions: Transaction[] = [
      createTestTransaction({
        id: "tx-inc",
        type: "income",
        amount: 500,
        from_account_id: null,
        to_account_id: "acc-1",
        transaction_date: "2026-08-01T10:00:00Z",
      }),
      createTestTransaction({
        id: "tx-exp",
        type: "expense",
        amount: 200,
        from_account_id: "acc-1",
        transaction_date: "2026-08-15T12:00:00Z",
      }),
    ];

    const result = calculateAccountBalance(account, transactions);
    expect(result.current_balance).toBe(1300);
    expect(result.transaction_count).toBe(2);
  });

  // 2. Baseline 1,000 + expense 200 before baseline => current balance remains 1,000
  it("Scenario 2: Baseline 1,000 + expense 200 before baseline => current balance remains 1,000", () => {
    const account = createTestAccount({
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z", // 11:30 Bangkok
    });
    const transactions: Transaction[] = [
      createTestTransaction({
        type: "expense",
        amount: 200,
        from_account_id: "acc-1",
        transaction_date: "2026-09-16T02:00:00.000Z", // 09:00 Bangkok (before baseline)
      }),
    ];

    const result = calculateAccountBalance(account, transactions);
    expect(result.current_balance).toBe(1000);
    expect(result.transaction_count).toBe(1);
  });

  // 3. Baseline 1,000 + expense 100 after baseline => current balance becomes 900
  it("Scenario 3: Baseline 1,000 + expense 100 after baseline => current balance becomes 900", () => {
    const account = createTestAccount({
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z", // 11:30 Bangkok
    });
    const transactions: Transaction[] = [
      createTestTransaction({
        type: "expense",
        amount: 100,
        from_account_id: "acc-1",
        transaction_date: "2026-09-16T05:00:00.000Z", // 12:00 Bangkok (after baseline)
      }),
    ];

    const result = calculateAccountBalance(account, transactions);
    expect(result.current_balance).toBe(900);
    expect(result.transaction_count).toBe(1);
  });

  // 4. Transaction exactly equal to balance_as_of is ignored for current balance (inclusive baseline)
  it("Scenario 4: Transaction exactly equal to balance_as_of is ignored for current balance (inclusive baseline)", () => {
    const baseline = "2026-09-16T04:30:00.000Z";
    const account = createTestAccount({
      opening_balance: 1000,
      balance_as_of: baseline,
    });
    const transactions: Transaction[] = [
      createTestTransaction({
        type: "expense",
        amount: 150,
        from_account_id: "acc-1",
        transaction_date: baseline, // Exactly at baseline timestamp
      }),
    ];

    expect(doesTransactionAffectAccountBalance(account, transactions[0])).toBe(false);
    const result = calculateAccountBalance(account, transactions);
    expect(result.current_balance).toBe(1000);
    expect(result.transaction_count).toBe(1);
  });

  // 5. Old income before baseline does not increase current balance
  it("Scenario 5: Old income before baseline does not increase current balance", () => {
    const account = createTestAccount({
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
    });
    const transactions: Transaction[] = [
      createTestTransaction({
        type: "income",
        amount: 5000,
        from_account_id: null,
        to_account_id: "acc-1",
        transaction_date: "2026-08-25T10:00:00.000Z", // 3 weeks before baseline
      }),
    ];

    const result = calculateAccountBalance(account, transactions);
    expect(result.current_balance).toBe(1000);
    expect(result.transaction_count).toBe(1);
  });

  // 6. Historical transaction still appears in transaction_count
  it("Scenario 6: Historical transaction still appears in transaction_count", () => {
    const account = createTestAccount({
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
    });
    const transactions: Transaction[] = [
      createTestTransaction({
        id: "tx-old-1",
        type: "expense",
        amount: 100,
        transaction_date: "2026-09-01T10:00:00Z",
      }),
      createTestTransaction({
        id: "tx-old-2",
        type: "expense",
        amount: 200,
        transaction_date: "2026-09-05T10:00:00Z",
      }),
      createTestTransaction({
        id: "tx-new-1",
        type: "expense",
        amount: 50,
        transaction_date: "2026-09-17T10:00:00Z",
      }),
    ];

    const result = calculateAccountBalance(account, transactions);
    expect(result.transaction_count).toBe(3); // All 3 transactions are counted
    expect(result.current_balance).toBe(950); // Only post-baseline expense modifies balance
  });

  // 7. Historical transaction still appears in monthly summary (income/expense/overview calculations)
  it("Scenario 7: Historical transaction still appears in monthly summary (income/expense/overview calculations)", () => {
    const transactions: Transaction[] = [
      createTestTransaction({
        id: "tx-aug",
        type: "expense",
        amount: 450,
        transaction_date: "2026-08-15T12:00:00Z",
      }),
      createTestTransaction({
        id: "tx-sep",
        type: "income",
        amount: 12000,
        from_account_id: null,
        to_account_id: "acc-1",
        transaction_date: "2026-09-02T09:00:00Z",
      }),
    ];

    const augSummary = calculateMonthSummary(transactions, new Date("2026-08-20"));
    expect(augSummary.expense_total).toBe(450);
    expect(augSummary.income_total).toBe(0);

    const sepSummary = calculateMonthSummary(transactions, new Date("2026-09-10"));
    expect(sepSummary.income_total).toBe(12000);
    expect(sepSummary.expense_total).toBe(0);
  });

  // 8. Historical expense still appears in category analytics
  it("Scenario 8: Historical expense still appears in category analytics", () => {
    const foodCat: Category = {
      id: "cat-food",
      user_id: "user-1",
      name: "Food",
      type: "expense",
      color: "#ff0000",
      icon: "utensils",
      is_system: true,
      created_at: "",
      updated_at: "",
    };
    const transactions: Transaction[] = [
      createTestTransaction({
        id: "tx-pre",
        category_id: "cat-food",
        type: "expense",
        amount: 120,
        transaction_date: "2026-08-10T12:00:00Z", // Pre-baseline
      }),
      createTestTransaction({
        id: "tx-post",
        category_id: "cat-food",
        type: "expense",
        amount: 180,
        transaction_date: "2026-09-18T12:00:00Z", // Post-baseline
      }),
    ];

    const summaries = calculateCategorySummaries(transactions, [foodCat]);
    const foodSummary = summaries.find((s) => s.category_id === "cat-food");
    expect(foodSummary).toBeDefined();
    expect(foodSummary?.total).toBe(300); // 120 + 180 = 300 THB intact
    expect(foodSummary?.count).toBe(2);
  });

  // 9. Old internal transfer with independent baseline per account
  it("Scenario 9: Old internal transfer with independent baseline per account", () => {
    // Account A: baseline 2026-09-16 11:30 Bangkok (transfer on Sep 10 is before A's baseline)
    const accountA = createTestAccount({
      id: "acc-a",
      opening_balance: 5000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
    });
    // Account B: baseline 2026-09-01 00:00 Bangkok (transfer on Sep 10 is after B's baseline)
    const accountB = createTestAccount({
      id: "acc-b",
      opening_balance: 1000,
      balance_as_of: "2026-08-31T17:00:00.000Z",
    });

    const transferTx = createTestTransaction({
      id: "tx-transfer",
      type: "transfer",
      amount: 800,
      from_account_id: "acc-a",
      to_account_id: "acc-b",
      transaction_date: "2026-09-10T08:00:00.000Z",
    });

    // Account A's baseline already encompasses the transfer, so balance is not reduced
    const balA = calculateAccountBalance(accountA, [transferTx]);
    expect(balA.current_balance).toBe(5000);
    expect(balA.transaction_count).toBe(1);

    // Account B's baseline was Sep 1, so the transfer on Sep 10 DOES increase Account B
    const balB = calculateAccountBalance(accountB, [transferTx]);
    expect(balB.current_balance).toBe(1800);
    expect(balB.transaction_count).toBe(1);
  });

  // 10. New internal transfer after both baselines adjusts source down and destination up
  it("Scenario 10: New internal transfer after both baselines adjusts source down and destination up, while net income/expense unchanged", () => {
    const accountA = createTestAccount({
      id: "acc-a",
      opening_balance: 5000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
    });
    const accountB = createTestAccount({
      id: "acc-b",
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
    });

    const transferTx = createTestTransaction({
      id: "tx-transfer-new",
      type: "transfer",
      amount: 700,
      from_account_id: "acc-a",
      to_account_id: "acc-b",
      transaction_date: "2026-09-17T08:00:00.000Z", // After both baselines
    });

    const balA = calculateAccountBalance(accountA, [transferTx]);
    expect(balA.current_balance).toBe(4300);

    const balB = calculateAccountBalance(accountB, [transferTx]);
    expect(balB.current_balance).toBe(1700);

    const monthSummary = calculateMonthSummary([transferTx], new Date("2026-09-17"));
    expect(monthSummary.income_total).toBe(0);
    expect(monthSummary.expense_total).toBe(0);
    expect(monthSummary.net_cash_flow).toBe(0);
  });

  // 11. Historical slip before baseline created successfully without changing balance
  it("Scenario 11: Historical slip before baseline created successfully without changing balance", () => {
    const account = createTestAccount({
      opening_balance: 687.04,
      balance_as_of: "2026-09-16T04:30:00.000Z", // 11:30 Bangkok
    });
    const historicalSlipTx = createTestTransaction({
      id: "tx-slip-hist",
      source: "slip",
      type: "expense",
      amount: 150,
      transaction_date: "2026-08-20T10:00:00.000Z",
    });

    const result = calculateAccountBalance(account, [historicalSlipTx]);
    expect(result.current_balance).toBe(687.04);
    expect(result.transaction_count).toBe(1);
  });

  // 12. Slip transaction after baseline changes current balance once
  it("Scenario 12: Slip transaction after baseline changes current balance once", () => {
    const account = createTestAccount({
      opening_balance: 687.04,
      balance_as_of: "2026-09-16T04:30:00.000Z",
    });
    const newSlipTx = createTestTransaction({
      id: "tx-slip-new",
      source: "slip",
      type: "expense",
      amount: 87.04,
      transaction_date: "2026-09-16T08:00:00.000Z", // 15:00 Bangkok
    });

    const result = calculateAccountBalance(account, [newSlipTx]);
    expect(result.current_balance).toBe(600);
    expect(result.transaction_count).toBe(1);
  });

  // 13. Editing transaction date from before -> after baseline begins including it
  it("Scenario 13: Editing transaction date from before -> after baseline begins including it in balance", () => {
    const account = createTestAccount({
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
    });
    const tx: Transaction = createTestTransaction({
      amount: 250,
      transaction_date: "2026-09-10T10:00:00.000Z", // Before baseline
    });

    // Before date edit
    const balBefore = calculateAccountBalance(account, [tx]);
    expect(balBefore.current_balance).toBe(1000);

    // After date edit to post-baseline
    const editedTx = { ...tx, transaction_date: "2026-09-18T10:00:00.000Z" };
    const balAfter = calculateAccountBalance(account, [editedTx]);
    expect(balAfter.current_balance).toBe(750);
  });

  // 14. Editing transaction date from after -> before baseline stops including it
  it("Scenario 14: Editing transaction date from after -> before baseline stops including it in balance", () => {
    const account = createTestAccount({
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
    });
    const tx: Transaction = createTestTransaction({
      amount: 250,
      transaction_date: "2026-09-18T10:00:00.000Z", // After baseline
    });

    const balBefore = calculateAccountBalance(account, [tx]);
    expect(balBefore.current_balance).toBe(750);

    const editedTx = { ...tx, transaction_date: "2026-09-10T10:00:00.000Z" }; // Moved before baseline
    const balAfter = calculateAccountBalance(account, [editedTx]);
    expect(balAfter.current_balance).toBe(1000);
  });

  // 15. Deleting historical transaction leaves balance unchanged
  it("Scenario 15: Deleting historical transaction leaves balance unchanged", () => {
    const account = createTestAccount({
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
    });
    const histTx = createTestTransaction({
      id: "tx-del",
      amount: 300,
      transaction_date: "2026-09-01T00:00:00Z",
    });

    const balWithTx = calculateAccountBalance(account, [histTx]);
    expect(balWithTx.current_balance).toBe(1000);
    expect(balWithTx.transaction_count).toBe(1);

    const balAfterDelete = calculateAccountBalance(account, []);
    expect(balAfterDelete.current_balance).toBe(1000);
    expect(balAfterDelete.transaction_count).toBe(0);
  });

  // 16. Deleting post-baseline transaction recalculates balance correctly
  it("Scenario 16: Deleting post-baseline transaction recalculates balance correctly", () => {
    const account = createTestAccount({
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
    });
    const postTx = createTestTransaction({
      id: "tx-del-post",
      amount: 150,
      transaction_date: "2026-09-17T00:00:00Z",
    });

    const balWithTx = calculateAccountBalance(account, [postTx]);
    expect(balWithTx.current_balance).toBe(850);

    const balAfterDelete = calculateAccountBalance(account, []);
    expect(balAfterDelete.current_balance).toBe(1000);
  });

  // 17. Bangkok datetime-local round-trip
  it("Scenario 17: Bangkok datetime-local round-trip for baseline timestamp", () => {
    const inputWallClock = "2026-09-16T11:30";
    const canonicalUtc = bangkokDateTimeLocalToCanonicalInstant(inputWallClock);
    expect(canonicalUtc).toBe("2026-09-16T04:30:00.000Z");

    const backToWallClock = canonicalInstantToBangkokDateTimeLocal(canonicalUtc!);
    expect(backToWallClock).toBe("2026-09-16T11:30");
  });

  // 18. Bangkok midnight boundary handling
  it("Scenario 18: Bangkok midnight boundary handling", () => {
    // 2026-09-16 00:00 Bangkok = 2026-09-15 17:00:00 UTC
    const midnightBangkokUtc = bangkokDateTimeLocalToCanonicalInstant("2026-09-16T00:00");
    expect(midnightBangkokUtc).toBe("2026-09-15T17:00:00.000Z");

    const account = createTestAccount({
      opening_balance: 2000,
      balance_as_of: midnightBangkokUtc,
    });

    // 1 second before midnight Bangkok (23:59:59 Sep 15 Bangkok = 16:59:59 UTC)
    const txBefore = createTestTransaction({
      amount: 100,
      transaction_date: "2026-09-15T16:59:59.000Z",
    });
    expect(doesTransactionAffectAccountBalance(account, txBefore)).toBe(false);

    // Exactly at midnight Bangkok
    const txExact = createTestTransaction({
      amount: 100,
      transaction_date: "2026-09-15T17:00:00.000Z",
    });
    expect(doesTransactionAffectAccountBalance(account, txExact)).toBe(false);

    // 1 second after midnight Bangkok (00:00:01 Sep 16 Bangkok = 17:00:01 UTC)
    const txAfter = createTestTransaction({
      amount: 100,
      transaction_date: "2026-09-15T17:00:01.000Z",
    });
    expect(doesTransactionAffectAccountBalance(account, txAfter)).toBe(true);

    const res = calculateAccountBalance(account, [txBefore, txExact, txAfter]);
    expect(res.current_balance).toBe(1900);
    expect(res.transaction_count).toBe(3);
  });

  // 19. Total active balance uses baseline-aware calculation across active accounts
  it("Scenario 19: Total active balance uses baseline-aware calculation across all active accounts", () => {
    const acc1 = createTestAccount({
      id: "acc-1",
      opening_balance: 1000,
      balance_as_of: "2026-09-16T00:00:00Z",
    });
    const acc2 = createTestAccount({
      id: "acc-2",
      opening_balance: 500,
      balance_as_of: null, // Legacy: includes all
    });
    const accArchived = createTestAccount({
      id: "acc-3",
      opening_balance: 200,
      active: false,
    });

    const txs: Transaction[] = [
      // Affects acc1 (after baseline)
      createTestTransaction({
        id: "tx-1",
        from_account_id: "acc-1",
        amount: 200,
        transaction_date: "2026-09-17T00:00:00Z",
      }),
      // Does NOT affect acc1 (before baseline)
      createTestTransaction({
        id: "tx-2",
        from_account_id: "acc-1",
        amount: 300,
        transaction_date: "2026-09-10T00:00:00Z",
      }),
      // Affects acc2 (legacy null baseline)
      createTestTransaction({
        id: "tx-3",
        from_account_id: "acc-2",
        amount: 50,
        transaction_date: "2026-09-01T00:00:00Z",
      }),
    ];

    const balances = calculateAllAccountBalances([acc1, acc2, accArchived], txs);
    expect(balances.find((b) => b.account.id === "acc-1")?.current_balance).toBe(800);
    expect(balances.find((b) => b.account.id === "acc-2")?.current_balance).toBe(450);

    const totalActive = calculateTotalActiveBalance([acc1, acc2, accArchived], txs);
    // 800 (acc1) + 450 (acc2) = 1250 (accArchived ignored)
    expect(totalActive).toBe(1250);
  });

  // 20. Accounts with different baseline timestamps remain independent
  it("Scenario 20: Accounts with different baseline timestamps remain completely independent", () => {
    const accEarly = createTestAccount({
      id: "acc-early",
      opening_balance: 1000,
      balance_as_of: "2026-09-01T00:00:00Z",
    });
    const accLate = createTestAccount({
      id: "acc-late",
      opening_balance: 1000,
      balance_as_of: "2026-09-15T00:00:00Z",
    });

    const midMonthTxEarly = createTestTransaction({
      id: "tx-mid-1",
      from_account_id: "acc-early",
      amount: 100,
      transaction_date: "2026-09-10T00:00:00Z",
    });
    const midMonthTxLate = createTestTransaction({
      id: "tx-mid-2",
      from_account_id: "acc-late",
      amount: 100,
      transaction_date: "2026-09-10T00:00:00Z",
    });

    // midMonthTxEarly is after Sep 1 -> deducted from accEarly
    expect(doesTransactionAffectAccountBalance(accEarly, midMonthTxEarly)).toBe(true);
    expect(calculateAccountBalance(accEarly, [midMonthTxEarly]).current_balance).toBe(900);

    // midMonthTxLate is before Sep 15 -> NOT deducted from accLate
    expect(doesTransactionAffectAccountBalance(accLate, midMonthTxLate)).toBe(false);
    expect(calculateAccountBalance(accLate, [midMonthTxLate]).current_balance).toBe(1000);
  });

  // 21. Existing MAKE by KBank account behaves identically before baseline is set
  it("Scenario 21: Existing MAKE by KBank account behaves identically before baseline is set", () => {
    const makeAccount = createTestAccount({
      name: "MAKE by KBank",
      opening_balance: 0,
      balance_as_of: null, // Legacy null baseline
    });

    const txs: Transaction[] = [
      createTestTransaction({
        type: "income",
        amount: 1500,
        from_account_id: null,
        to_account_id: makeAccount.id,
        transaction_date: "2026-07-01T00:00:00Z",
      }),
      createTestTransaction({
        type: "expense",
        amount: 300,
        from_account_id: makeAccount.id,
        transaction_date: "2026-08-01T00:00:00Z",
      }),
    ];

    const bal = calculateAccountBalance(makeAccount, txs);
    expect(bal.current_balance).toBe(1200);
    expect(bal.transaction_count).toBe(2);
  });

  // 22. DataStore and Account schemas validate and persist balance_as_of without regressions
  it("Scenario 22: DataStore and Account schemas validate and persist balance_as_of without regressions", async () => {
    // 1. Validate accountSchema
    const validWithIso = accountSchema.safeParse({
      name: "SCB Savings",
      type: "bank",
      currency: "THB",
      opening_balance: 500,
      balance_as_of: "2026-09-16T04:30:00.000Z",
    });
    expect(validWithIso.success).toBe(true);

    const validWithNull = accountSchema.safeParse({
      name: "SCB Savings",
      type: "bank",
      currency: "THB",
      opening_balance: 500,
      balance_as_of: null,
    });
    expect(validWithNull.success).toBe(true);

    const validWithEmpty = accountSchema.safeParse({
      name: "SCB Savings",
      type: "bank",
      currency: "THB",
      opening_balance: 500,
      balance_as_of: "",
    });
    expect(validWithEmpty.success).toBe(true);

    const invalidDate = accountSchema.safeParse({
      name: "SCB Savings",
      type: "bank",
      currency: "THB",
      opening_balance: 500,
      balance_as_of: "not-a-date",
    });
    expect(invalidDate.success).toBe(false);

    // 2. MemoryDataStore persistence
    MemoryDataStore.reset();
    const created = await MemoryDataStore.createAccount("user-test", {
      name: "Test Baseline Account",
      type: "bank",
      currency: "THB",
      opening_balance: 2500,
      balance_as_of: "2026-09-16T04:30:00.000Z",
      active: true,
    });
    expect(created.balance_as_of).toBe("2026-09-16T04:30:00.000Z");

    const fetched = await MemoryDataStore.getAccountById("user-test", created.id);
    expect(fetched?.balance_as_of).toBe("2026-09-16T04:30:00.000Z");

    // Update account with updated baseline
    const updated = await MemoryDataStore.updateAccount("user-test", created.id, {
      balance_as_of: "2026-09-20T00:00:00.000Z",
    });
    expect(updated.balance_as_of).toBe("2026-09-20T00:00:00.000Z");

    // Clear baseline
    const cleared = await MemoryDataStore.updateAccount("user-test", created.id, {
      balance_as_of: null,
    });
    expect(cleared.balance_as_of).toBeNull();
  });
});

describe("Finn — Balance Baseline Final Fail-Closed Validation Suite", () => {
  beforeEach(() => {
    MemoryDataStore.reset();
  });

  it("1. non-empty malformed balance_as_of submitted to create action => rejected with validation error", async () => {
    const fd = new FormData();
    fd.set("name", "SCB Fail Closed");
    fd.set("type", "bank");
    fd.set("opening_balance", "1000");
    fd.set("balance_as_of", "not-a-valid-date");

    const res = await createAccountAction(null, fd);
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();

    // Verify no account was created in the database
    const accounts = await MemoryDataStore.getAccounts("user-1");
    expect(accounts.find((a) => a.name === "SCB Fail Closed")).toBeUndefined();
  });

  it("2. non-empty malformed balance_as_of submitted to update action => rejected, baseline NOT silently cleared", async () => {
    // Existing account with active baseline
    const existing = await MemoryDataStore.createAccount("user-1", {
      name: "Existing KBank",
      type: "bank",
      currency: "THB",
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
      active: true,
    });

    const fd = new FormData();
    fd.set("name", "Existing KBank");
    fd.set("type", "bank");
    fd.set("opening_balance", "1000");
    fd.set("balance_as_of", "malformed-garbage-date");

    const res = await updateAccountAction(existing.id, null, fd);
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();

    // Verify baseline was NOT modified or cleared to null
    const afterUpdate = await MemoryDataStore.getAccountById("user-1", existing.id);
    expect(afterUpdate?.balance_as_of).toBe("2026-09-16T04:30:00.000Z");
  });

  it("3. intentionally empty balance_as_of => clears baseline to null", async () => {
    const existing = await MemoryDataStore.createAccount("user-1", {
      name: "Existing KBank",
      type: "bank",
      currency: "THB",
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
      active: true,
    });

    const fd = new FormData();
    fd.set("name", "Existing KBank");
    fd.set("type", "bank");
    fd.set("opening_balance", "1000");
    fd.set("balance_as_of", ""); // Intentionally empty string

    const res = await updateAccountAction(existing.id, null, fd);
    expect(res.success).toBe(true);

    const afterUpdate = await MemoryDataStore.getAccountById("user-1", existing.id);
    expect(afterUpdate?.balance_as_of).toBeNull();
  });

  it("4. valid Bangkok datetime-local => canonical UTC stored", async () => {
    const fd = new FormData();
    fd.set("name", "Bangkok DateTime Account");
    fd.set("type", "bank");
    fd.set("opening_balance", "5000");
    fd.set("balance_as_of", "2026-09-16T11:30"); // Bangkok local wall-clock

    const res = await createAccountAction(null, fd);
    expect(res.success).toBe(true);

    const accounts = await MemoryDataStore.getAccounts("user-1");
    const created = accounts.find((a) => a.name === "Bangkok DateTime Account");
    expect(created).toBeDefined();
    // 11:30 Bangkok = 04:30 UTC
    expect(created?.balance_as_of).toBe("2026-09-16T04:30:00.000Z");
  });

  it("5. valid canonical ISO => preserved as same instant", async () => {
    const canonical = "2026-09-16T04:30:00.000Z";
    const fd = new FormData();
    fd.set("name", "Canonical ISO Account");
    fd.set("type", "bank");
    fd.set("opening_balance", "5000");
    fd.set("balance_as_of", canonical);

    const res = await createAccountAction(null, fd);
    expect(res.success).toBe(true);

    const accounts = await MemoryDataStore.getAccounts("user-1");
    const created = accounts.find((a) => a.name === "Canonical ISO Account");
    expect(created?.balance_as_of).toBe(canonical);
  });

  it("6. invalid tx timestamp with active baseline => does not alter balance (fail-closed)", () => {
    const account: Account = {
      id: "acc-failclose",
      user_id: "user-1",
      name: "Fail Close Account",
      type: "bank",
      currency: "THB",
      opening_balance: 1000,
      balance_as_of: "2026-09-16T04:30:00.000Z",
      active: true,
      created_at: "",
      updated_at: "",
    };

    const invalidTx: Transaction = {
      id: "tx-corrupt",
      user_id: "user-1",
      type: "expense",
      amount: 400,
      from_account_id: "acc-failclose",
      to_account_id: null,
      currency: "THB",
      transaction_date: "invalid-garbage-date",
      source: "manual",
      confidence: 1,
      review_status: "confirmed",
      tax_deductible: false,
      created_at: "",
      updated_at: "",
    };

    expect(doesTransactionAffectAccountBalance(account, invalidTx)).toBe(false);
    const balanceResult = calculateAccountBalance(account, [invalidTx]);
    // Current balance remains 1000 THB; historical corrupt delta is NOT applied
    expect(balanceResult.current_balance).toBe(1000);
    // Corrupt transaction is still counted in transaction count
    expect(balanceResult.transaction_count).toBe(1);
  });

  it("7. invalid baseline timestamp => does not apply arbitrary historical deltas (fail-closed)", () => {
    const accountWithCorruptedBaseline: Account = {
      id: "acc-corrupt-baseline",
      user_id: "user-1",
      name: "Corrupted Baseline Account",
      type: "bank",
      currency: "THB",
      opening_balance: 1000,
      balance_as_of: "unparseable-baseline-timestamp",
      active: true,
      created_at: "",
      updated_at: "",
    };

    const validTx: Transaction = {
      id: "tx-valid",
      user_id: "user-1",
      type: "expense",
      amount: 400,
      from_account_id: "acc-corrupt-baseline",
      to_account_id: null,
      currency: "THB",
      transaction_date: "2026-09-16T05:00:00.000Z",
      source: "manual",
      confidence: 1,
      review_status: "confirmed",
      tax_deductible: false,
      created_at: "",
      updated_at: "",
    };

    expect(doesTransactionAffectAccountBalance(accountWithCorruptedBaseline, validTx)).toBe(false);
    const balanceResult = calculateAccountBalance(accountWithCorruptedBaseline, [validTx]);
    // Current balance remains 1000 THB; cannot safely determine post-baseline status
    expect(balanceResult.current_balance).toBe(1000);
    expect(balanceResult.transaction_count).toBe(1);
  });

  it("8. parseStrictBaselineInstant rejects environment-dependent ambiguous strings", () => {
    // Ambiguous local formats without timezone or time
    expect(parseStrictBaselineInstant("09/16/2026").success).toBe(false);
    expect(parseStrictBaselineInstant("16-09-2026").success).toBe(false);
    expect(parseStrictBaselineInstant("yesterday").success).toBe(false);
    expect(parseStrictBaselineInstant("2026-02-30T12:00").success).toBe(false); // Invalid calendar date

    // Valid formats succeed
    expect(parseStrictBaselineInstant("2026-09-16T11:30").success).toBe(true);
    expect(parseStrictBaselineInstant("2026-09-16T04:30:00.000Z").success).toBe(true);
    expect(parseStrictBaselineInstant("2026-09-16T11:30:00+07:00").success).toBe(true);

    // Empty formats succeed as cleared
    const emptyRes = parseStrictBaselineInstant("");
    expect(emptyRes.success).toBe(true);
    if (emptyRes.success) {
      expect(emptyRes.instant).toBeNull();
    }
  });
});
