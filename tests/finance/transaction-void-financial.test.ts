import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  calculateAccountBalance,
  calculateAccountBalanceAt,
  calculateAllAccountBalances,
  calculateTotalActiveBalance,
  isFinanciallyActiveTransaction,
  doesTransactionAffectAccountBalance,
} from "@/lib/finance/balances";
import {
  calculateCategorySummaries,
  calculateMonthSummary,
  calculateMonthlyTrends,
} from "@/lib/finance/summaries";
import { calculatePersonSummary } from "@/lib/finance/people";
import { calculateMerchantSummary } from "@/lib/finance/merchants";
import { getDailyFinancialSummaries } from "@/lib/finance/calendar";
import { classifyIngestionMatch } from "@/lib/ingestion/deduplication";
import { MemoryDataStore } from "@/lib/server/memory-data-store";
import {
  Account,
  Category,
  Merchant,
  Person,
  Transaction,
  TransactionWithRelations,
} from "@/types/finance";
import { IngestionItem, SourceDocument } from "@/types/multi-source";

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock auth
const testUser = { id: "user-void-test", email: "user@test.local" };
vi.mock("@/lib/server/auth", () => ({
  requireUser: vi.fn(async () => testUser),
  getAuthenticatedUser: vi.fn(async () => testUser),
}));

describe("FINN — Transaction Void & Restore Financial Calculations Suite (20 Scenarios)", () => {
  const userId = testUser.id;

  const createAccount = (overrides: Partial<Account> = {}): Account => ({
    id: "acc-1",
    user_id: userId,
    name: "Savings Account",
    type: "bank",
    institution: "KBANK",
    currency: "THB",
    opening_balance: 10000,
    balance_as_of: "2026-09-01T00:00:00.000Z",
    active: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  });

  const createTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
    id: "tx-1",
    user_id: userId,
    type: "expense",
    amount: 1000,
    currency: "THB",
    transaction_date: "2026-09-10T12:00:00.000Z",
    description: "Office supplies",
    from_account_id: "acc-1",
    to_account_id: null,
    category_id: "cat-1",
    person_id: null,
    merchant_id: null,
    payment_method: "transfer",
    source: "manual",
    source_slip_id: null,
    source_document_id: null,
    review_status: "confirmed",
    confidence: 1.0,
    created_at: "2026-09-10T12:00:00.000Z",
    updated_at: "2026-09-10T12:00:00.000Z",
    tax_deductible: false,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    ...overrides,
  });

  beforeEach(() => {
    MemoryDataStore.reset();
  });

  // =========================================================================
  // Scenario 1: Void expense reversal
  // =========================================================================
  it("Scenario 1: void expense reversal — balance returns to pre-expense amount", () => {
    const account = createAccount({ opening_balance: 10000, balance_as_of: "2026-09-01T00:00:00.000Z" });
    const expenseTx = createTransaction({
      id: "tx-exp",
      type: "expense",
      amount: 1000,
      from_account_id: account.id,
      transaction_date: "2026-09-05T00:00:00.000Z",
      voided_at: null,
    });

    const activeBalance = calculateAccountBalance(account, [expenseTx]);
    expect(activeBalance.current_balance).toBe(9000);
    expect(activeBalance.transaction_count).toBe(1);

    // Void the transaction
    const voidedExpenseTx: Transaction = {
      ...expenseTx,
      voided_at: "2026-09-15T00:00:00.000Z",
      voided_by: userId,
      void_reason: "Mistakenly created",
    };

    const voidedBalance = calculateAccountBalance(account, [voidedExpenseTx]);
    expect(voidedBalance.current_balance).toBe(10000);
    expect(voidedBalance.transaction_count).toBe(0);
  });

  // =========================================================================
  // Scenario 2: Restore expense reapplication
  // =========================================================================
  it("Scenario 2: restore expense reapplication — expense correctly reduces balance again", () => {
    const account = createAccount({ opening_balance: 10000, balance_as_of: "2026-09-01T00:00:00.000Z" });
    const voidedTx = createTransaction({
      id: "tx-exp",
      type: "expense",
      amount: 1000,
      from_account_id: account.id,
      transaction_date: "2026-09-05T00:00:00.000Z",
      voided_at: "2026-09-15T00:00:00.000Z",
      voided_by: userId,
      void_reason: "Mistake",
    });

    expect(calculateAccountBalance(account, [voidedTx]).current_balance).toBe(10000);

    // Restore
    const restoredTx: Transaction = {
      ...voidedTx,
      voided_at: null,
      voided_by: null,
      void_reason: null,
    };

    const restoredBalance = calculateAccountBalance(account, [restoredTx]);
    expect(restoredBalance.current_balance).toBe(9000);
    expect(restoredBalance.transaction_count).toBe(1);
  });

  // =========================================================================
  // Scenario 3: Idempotency of void
  // =========================================================================
  it("Scenario 3: idempotency of void — voiding an already voided tx does not alter state or balance", async () => {
    const account = await MemoryDataStore.createAccount(userId, {
      name: "Account",
      type: "bank",
      currency: "THB",
      opening_balance: 5000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
    });

    const tx = await MemoryDataStore.createTransaction(userId, {
      type: "expense",
      amount: 500,
      from_account_id: account.id,
      currency: "THB",
      transaction_date: "2026-09-05T00:00:00.000Z",
      description: "Test Expense",
    });

    // First void
    const void1 = await MemoryDataStore.voidTransaction(userId, tx.id, "First void");
    expect(void1.voided_at).toBeDefined();
    expect(void1.void_reason).toBe("First void");
    expect(void1.already_voided).toBe(false);

    const eventsAfterFirst = await MemoryDataStore.getTransactionVoidEvents(userId, tx.id);
    expect(eventsAfterFirst.length).toBe(1);

    // Second void (idempotent call)
    const void2 = await MemoryDataStore.voidTransaction(userId, tx.id, "Second void attempt");
    expect(void2.voided_at).toBe(void1.voided_at);
    expect(void2.already_voided).toBe(true);

    // Events count remains 1 because no new state transition occurred
    const eventsAfterSecond = await MemoryDataStore.getTransactionVoidEvents(userId, tx.id);
    expect(eventsAfterSecond.length).toBe(1);

    // Balance verification
    const transactions = await MemoryDataStore.getTransactions(userId);
    const bal = calculateAccountBalance(account, transactions);
    expect(bal.current_balance).toBe(5000);
  });

  // =========================================================================
  // Scenario 4: Idempotency of restore
  // =========================================================================
  it("Scenario 4: idempotency of restore — restoring an active tx does not duplicate deltas", async () => {
    const account = await MemoryDataStore.createAccount(userId, {
      name: "Account",
      type: "bank",
      currency: "THB",
      opening_balance: 5000,
      balance_as_of: "2026-09-01T00:00:00.000Z",
    });

    const tx = await MemoryDataStore.createTransaction(userId, {
      type: "expense",
      amount: 500,
      from_account_id: account.id,
      currency: "THB",
      transaction_date: "2026-09-05T00:00:00.000Z",
      description: "Test Expense",
    });

    // Attempting to restore an already active tx
    const restoreRes = await MemoryDataStore.restoreTransaction(userId, tx.id, "Redundant restore");
    expect(restoreRes.already_active).toBe(true);

    const events = await MemoryDataStore.getTransactionVoidEvents(userId, tx.id);
    expect(events.length).toBe(0);

    const transactions = await MemoryDataStore.getTransactions(userId);
    const bal = calculateAccountBalance(account, transactions);
    expect(bal.current_balance).toBe(4500);
  });

  // =========================================================================
  // Scenario 5: Void income reversal
  // =========================================================================
  it("Scenario 5: void income reversal — income stops increasing the balance", () => {
    const account = createAccount({ opening_balance: 10000, balance_as_of: "2026-09-01T00:00:00.000Z" });
    const incomeTx = createTransaction({
      id: "tx-inc",
      type: "income",
      amount: 2500,
      from_account_id: null,
      to_account_id: account.id,
      transaction_date: "2026-09-05T00:00:00.000Z",
    });

    expect(calculateAccountBalance(account, [incomeTx]).current_balance).toBe(12500);

    const voidedIncomeTx: Transaction = {
      ...incomeTx,
      voided_at: "2026-09-12T00:00:00.000Z",
      voided_by: userId,
      void_reason: "Customer refunded / erroneous entry",
    };

    expect(calculateAccountBalance(account, [voidedIncomeTx]).current_balance).toBe(10000);
  });

  // =========================================================================
  // Scenario 6: Restore income reapplication
  // =========================================================================
  it("Scenario 6: restore income reapplication — balance correctly increases back to 12,500", () => {
    const account = createAccount({ opening_balance: 10000, balance_as_of: "2026-09-01T00:00:00.000Z" });
    const voidedIncomeTx = createTransaction({
      id: "tx-inc",
      type: "income",
      amount: 2500,
      to_account_id: account.id,
      transaction_date: "2026-09-05T00:00:00.000Z",
      voided_at: "2026-09-12T00:00:00.000Z",
      void_reason: "Mistake",
    });

    expect(calculateAccountBalance(account, [voidedIncomeTx]).current_balance).toBe(10000);

    const restoredIncomeTx: Transaction = {
      ...voidedIncomeTx,
      voided_at: null,
      voided_by: null,
      void_reason: null,
    };

    expect(calculateAccountBalance(account, [restoredIncomeTx]).current_balance).toBe(12500);
  });

  // =========================================================================
  // Scenario 7: Void transfer isolation
  // =========================================================================
  it("Scenario 7: void transfer isolation — reverses both accounts simultaneously", () => {
    const accountA = createAccount({ id: "acc-A", name: "Checking", opening_balance: 10000, balance_as_of: "2026-09-01T00:00:00.000Z" });
    const accountB = createAccount({ id: "acc-B", name: "Savings", opening_balance: 5000, balance_as_of: "2026-09-01T00:00:00.000Z" });

    const transferTx = createTransaction({
      id: "tx-xfer",
      type: "transfer",
      amount: 2000,
      from_account_id: accountA.id,
      to_account_id: accountB.id,
      transaction_date: "2026-09-06T00:00:00.000Z",
    });

    expect(calculateAccountBalance(accountA, [transferTx]).current_balance).toBe(8000);
    expect(calculateAccountBalance(accountB, [transferTx]).current_balance).toBe(7000);

    // Void the transfer
    const voidedTransfer: Transaction = {
      ...transferTx,
      voided_at: "2026-09-10T00:00:00.000Z",
      voided_by: userId,
      void_reason: "Duplicate transfer",
    };

    expect(calculateAccountBalance(accountA, [voidedTransfer]).current_balance).toBe(10000);
    expect(calculateAccountBalance(accountB, [voidedTransfer]).current_balance).toBe(5000);
  });

  // =========================================================================
  // Scenario 8: Restore transfer reapplication
  // =========================================================================
  it("Scenario 8: restore transfer reapplication — re-applies debit on source and credit on destination", () => {
    const accountA = createAccount({ id: "acc-A", opening_balance: 10000, balance_as_of: "2026-09-01T00:00:00.000Z" });
    const accountB = createAccount({ id: "acc-B", opening_balance: 5000, balance_as_of: "2026-09-01T00:00:00.000Z" });

    const voidedTransfer = createTransaction({
      id: "tx-xfer",
      type: "transfer",
      amount: 2000,
      from_account_id: accountA.id,
      to_account_id: accountB.id,
      transaction_date: "2026-09-06T00:00:00.000Z",
      voided_at: "2026-09-10T00:00:00.000Z",
    });

    const restoredTransfer: Transaction = {
      ...voidedTransfer,
      voided_at: null,
      voided_by: null,
      void_reason: null,
    };

    expect(calculateAccountBalance(accountA, [restoredTransfer]).current_balance).toBe(8000);
    expect(calculateAccountBalance(accountB, [restoredTransfer]).current_balance).toBe(7000);
  });

  // =========================================================================
  // Scenario 9: Pre-baseline vs post-baseline void
  // =========================================================================
  it("Scenario 9: pre-baseline vs post-baseline void behavior", () => {
    const baselineDate = "2026-09-10T00:00:00.000Z";
    const account = createAccount({
      opening_balance: 10000,
      balance_as_of: baselineDate,
    });

    // 1. A pre-baseline transaction (prior to 2026-09-10) has zero effect on current balance whether active or voided
    const preBaselineTx = createTransaction({
      id: "tx-pre",
      amount: 500,
      type: "expense",
      transaction_date: "2026-09-05T00:00:00.000Z",
      from_account_id: account.id,
      voided_at: null,
    });
    expect(calculateAccountBalance(account, [preBaselineTx]).current_balance).toBe(10000);

    const voidedPreBaselineTx: Transaction = {
      ...preBaselineTx,
      voided_at: "2026-09-12T00:00:00.000Z",
    };
    expect(calculateAccountBalance(account, [voidedPreBaselineTx]).current_balance).toBe(10000);

    // 2. A post-baseline transaction affects balance when active, but returns balance to baseline when voided
    const postBaselineTx = createTransaction({
      id: "tx-post",
      amount: 700,
      type: "expense",
      transaction_date: "2026-09-12T00:00:00.000Z",
      from_account_id: account.id,
      voided_at: null,
    });
    expect(calculateAccountBalance(account, [postBaselineTx]).current_balance).toBe(9300);

    const voidedPostBaselineTx: Transaction = {
      ...postBaselineTx,
      voided_at: "2026-09-14T00:00:00.000Z",
    };
    expect(calculateAccountBalance(account, [voidedPostBaselineTx]).current_balance).toBe(10000);
  });

  // =========================================================================
  // Scenario 10: calculateAccountBalanceAt historical as-of query
  // =========================================================================
  it("Scenario 10: calculateAccountBalanceAt historical query ignores voided records", () => {
    const account = createAccount({
      opening_balance: 5000,
      balance_as_of: null, // ledger based
    });

    const tx1 = createTransaction({
      id: "tx-1",
      amount: 1000,
      type: "income",
      to_account_id: account.id,
      transaction_date: "2026-09-02T00:00:00.000Z",
    });

    const tx2 = createTransaction({
      id: "tx-2",
      amount: 400,
      type: "expense",
      from_account_id: account.id,
      transaction_date: "2026-09-04T00:00:00.000Z",
      voided_at: "2026-09-08T00:00:00.000Z",
      void_reason: "Voided",
    });

    // Query balance at 2026-09-05 (after tx2 transaction_date, but tx2 is voided)
    const asOfSep5 = calculateAccountBalanceAt(account, [tx1, tx2], "2026-09-05T00:00:00.000Z");
    // tx2 is voided, so only tx1 (+1000) contributes to opening_balance 5000 => 6000
    expect(asOfSep5.balance).toBe(6000);
    expect(asOfSep5.transaction_count).toBe(1);

    // If tx2 is restored, it contributes
    const tx2Restored: Transaction = { ...tx2, voided_at: null };
    const asOfSep5Restored = calculateAccountBalanceAt(account, [tx1, tx2Restored], "2026-09-05T00:00:00.000Z");
    expect(asOfSep5Restored.balance).toBe(5600);
    expect(asOfSep5Restored.transaction_count).toBe(2);
  });

  // =========================================================================
  // Scenario 11: calculateMonthSummary exclusion
  // =========================================================================
  it("Scenario 11: calculateMonthSummary strictly excludes voided transactions", () => {
    const activeExpense = createTransaction({
      id: "tx-exp-active",
      type: "expense",
      amount: 500,
      transaction_date: "2026-09-10T00:00:00.000Z",
      voided_at: null,
    });
    const voidedExpense = createTransaction({
      id: "tx-exp-voided",
      type: "expense",
      amount: 1500,
      transaction_date: "2026-09-11T00:00:00.000Z",
      voided_at: "2026-09-12T00:00:00.000Z",
    });
    const activeIncome = createTransaction({
      id: "tx-inc-active",
      type: "income",
      amount: 3000,
      transaction_date: "2026-09-05T00:00:00.000Z",
      voided_at: null,
    });
    const voidedIncome = createTransaction({
      id: "tx-inc-voided",
      type: "income",
      amount: 10000,
      transaction_date: "2026-09-06T00:00:00.000Z",
      voided_at: "2026-09-12T00:00:00.000Z",
    });

    const summary = calculateMonthSummary(
      [activeExpense, voidedExpense, activeIncome, voidedIncome],
      new Date("2026-09-15T00:00:00.000Z")
    );

    expect(summary.income_total).toBe(3000);
    expect(summary.expense_total).toBe(500);
    expect(summary.net_cash_flow).toBe(2500);
  });

  // =========================================================================
  // Scenario 12: calculateCategorySummaries exclusion
  // =========================================================================
  it("Scenario 12: calculateCategorySummaries strictly excludes voided transactions", () => {
    const category: Category = {
      id: "cat-dining",
      name: "Dining",
      type: "expense",
      is_system: false,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    };

    const activeTx = createTransaction({
      id: "tx-dine-1",
      category_id: category.id,
      amount: 300,
      type: "expense",
      transaction_date: "2026-09-10T00:00:00.000Z",
      voided_at: null,
    });

    const voidedTx = createTransaction({
      id: "tx-dine-2",
      category_id: category.id,
      amount: 1200,
      type: "expense",
      transaction_date: "2026-09-12T00:00:00.000Z",
      voided_at: "2026-09-13T00:00:00.000Z",
    });

    const summaries = calculateCategorySummaries(
      [activeTx, voidedTx],
      [category],
      "expense"
    );

    const diningSummary = summaries.find((s) => s.category_id === category.id);
    expect(diningSummary).toBeDefined();
    expect(diningSummary?.total).toBe(300);
    expect(diningSummary?.count).toBe(1);
  });

  // =========================================================================
  // Scenario 13: calculateMonthlyTrends exclusion
  // =========================================================================
  it("Scenario 13: calculateMonthlyTrends excludes voided income and expenses", () => {
    // Determine current month in Bangkok to construct realistic trend dates
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
    const currentYm = `${currentYear}-${currentMonth}`;

    const txs: Transaction[] = [
      createTransaction({
        id: "tx-trend-1",
        type: "expense",
        amount: 400,
        transaction_date: `${currentYm}-05T00:00:00.000Z`,
        voided_at: null,
      }),
      createTransaction({
        id: "tx-trend-2",
        type: "expense",
        amount: 8000,
        transaction_date: `${currentYm}-06T00:00:00.000Z`,
        voided_at: `${currentYm}-10T00:00:00.000Z`,
      }),
    ];

    const trends = calculateMonthlyTrends(txs, 3);
    const trend = trends.find((t) => t.yearMonth === currentYm);
    expect(trend).toBeDefined();
    expect(trend?.expense).toBe(400);
  });

  // =========================================================================
  // Scenario 14: People & Merchants summaries exclusion
  // =========================================================================
  it("Scenario 14: calculatePersonSummary and calculateMerchantSummary exclude voided transactions", () => {
    const person: Person = {
      id: "p-1",
      user_id: userId,
      display_name: "Alice",
      normalized_name: "alice",
      aliases: [],
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    };
    const merchant: Merchant = {
      id: "m-1",
      user_id: userId,
      display_name: "Starbucks",
      normalized_name: "starbucks",
      aliases: [],
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    };

    const personTxActive = createTransaction({
      person_id: person.id,
      amount: 500,
      type: "expense",
      voided_at: null,
    });
    const personTxVoided = createTransaction({
      person_id: person.id,
      amount: 1500,
      type: "expense",
      voided_at: "2026-09-12T00:00:00.000Z",
    });

    const personSummary = calculatePersonSummary(person, [personTxActive, personTxVoided]);
    expect(personSummary.total_paid).toBe(500);
    expect(personSummary.transaction_count).toBe(1);

    const merchantTxActive = createTransaction({
      merchant_id: merchant.id,
      amount: 180,
      type: "expense",
      voided_at: null,
    });
    const merchantTxVoided = createTransaction({
      merchant_id: merchant.id,
      amount: 1000,
      type: "expense",
      voided_at: "2026-09-12T00:00:00.000Z",
    });

    const merchantSummary = calculateMerchantSummary(merchant, [merchantTxActive, merchantTxVoided]);
    expect(merchantSummary.total_spent).toBe(180);
    expect(merchantSummary.transaction_count).toBe(1);
  });

  // =========================================================================
  // Scenario 15: Calendar day summary exclusion
  // =========================================================================
  it("Scenario 15: getDailyFinancialSummaries excludes voided transactions", () => {
    const activeTx: TransactionWithRelations = {
      ...createTransaction({
        id: "tx-cal-1",
        amount: 200,
        type: "expense",
        transaction_date: "2026-09-15T10:00:00.000Z",
        voided_at: null,
      }),
    };
    const voidedTx: TransactionWithRelations = {
      ...createTransaction({
        id: "tx-cal-2",
        amount: 800,
        type: "expense",
        transaction_date: "2026-09-15T11:00:00.000Z",
        voided_at: "2026-09-15T12:00:00.000Z",
      }),
    };

    const summariesMap = getDailyFinancialSummaries([activeTx, voidedTx], 2026, 9);
    // Find the summary for September 15
    const daySummary = Array.from(summariesMap.values()).find((d) => d.day === 15);
    expect(daySummary).toBeDefined();
    expect(daySummary?.expense).toBe(200);
    expect(daySummary?.transactionCount).toBe(1);
  });

  // =========================================================================
  // Scenario 16: Ingestion / Deduplication candidate matching ignores voided txs
  // =========================================================================
  it("Scenario 16: classifyIngestionMatch does NOT suggest voided transactions as duplicate candidates", () => {
    const item: IngestionItem = {
      id: "item-1",
      user_id: userId,
      connection_id: "conn-1",
      source_document_id: "doc-1",
      batch_id: "batch-1",
      item_type: "statement_row",
      status: "pending",
      match_class: "no_match",
      confidence_score: 1.0,
      provider_external_id: null,
      parsed_data: {
        amount: 150000,
        amount_decimal: 1500,
        direction: "outgoing",
        occurred_at: "2026-09-10T10:00:00.000Z",
        description: "Grab",
      },
      created_at: "2026-09-10T10:00:00.000Z",
      updated_at: "2026-09-10T10:00:00.000Z",
    };

    // A voided transaction with identical amount, timestamp, description
    const voidedTx = createTransaction({
      id: "tx-duplicate-candidate",
      amount: 1500,
      type: "expense",
      transaction_date: "2026-09-10T10:00:00.000Z",
      description: "Grab",
      voided_at: "2026-09-11T00:00:00.000Z",
      void_reason: "Mistake",
    });

    const resultWithVoided = classifyIngestionMatch({
      item,
      existingTransactions: [voidedTx],
    });

    // Voided tx should NOT be matched as possible duplicate
    expect(resultWithVoided.matchClass).toBe("no_match");
    expect(resultWithVoided.candidates?.length || 0).toBe(0);

    // When the transaction is active, it WOULD be matched as a possible candidate
    const activeTx = { ...voidedTx, voided_at: null };
    const resultWithActive = classifyIngestionMatch({
      item,
      existingTransactions: [activeTx],
    });
    expect(resultWithActive.matchClass).toBe("possible_match");
    expect(resultWithActive.candidates?.some((m) => m.transaction_id === activeTx.id)).toBe(true);
  });

  // =========================================================================
  // Scenario 17: Active count exclusion
  // =========================================================================
  it("Scenario 17: calculateAccountBalance active transaction count excludes voided transactions", () => {
    const account = createAccount({ opening_balance: 1000 });
    const tx1 = createTransaction({ id: "tx-1", voided_at: null });
    const tx2 = createTransaction({ id: "tx-2", voided_at: "2026-09-12T00:00:00.000Z" });
    const tx3 = createTransaction({ id: "tx-3", voided_at: null });

    const balance = calculateAccountBalance(account, [tx1, tx2, tx3]);
    expect(balance.transaction_count).toBe(2);
  });

  // =========================================================================
  // Scenario 18: Evidence preservation & delete prevention
  // =========================================================================
  it("Scenario 18: voided transaction preserves evidence and cannot be deleted via deleteTransaction", async () => {
    const account = await MemoryDataStore.createAccount(userId, {
      name: "Account",
      type: "bank",
      currency: "THB",
      opening_balance: 5000,
    });

    const tx = await MemoryDataStore.createTransaction(userId, {
      type: "expense",
      amount: 800,
      from_account_id: account.id,
      currency: "THB",
      transaction_date: "2026-09-10T00:00:00.000Z",
      description: "Slip-backed expense",
      source: "slip",
      source_slip_id: "slip-uuid-1234",
    });

    // Void it
    await MemoryDataStore.voidTransaction(userId, tx.id, "Slip was duplicated");

    // Check that evidence and source links are 100% preserved
    const voidedTx = await MemoryDataStore.getTransactionById(userId, tx.id);
    expect(voidedTx).not.toBeNull();
    expect(voidedTx?.source_slip_id).toBe("slip-uuid-1234");
    expect(voidedTx?.source).toBe("slip");
    expect(voidedTx?.voided_at).not.toBeNull();
    expect(voidedTx?.void_reason).toBe("Slip was duplicated");

    // Attempting to delete this transaction must fail (FK restrict / audit protection)
    await expect(MemoryDataStore.deleteTransaction(userId, tx.id)).rejects.toThrow();
  });

  // =========================================================================
  // Scenario 19: Original transaction ID reuse
  // =========================================================================
  it("Scenario 19: restore reactivates the exact same transaction ID without creating a duplicate record", async () => {
    const account = await MemoryDataStore.createAccount(userId, {
      name: "Account",
      type: "bank",
      currency: "THB",
      opening_balance: 5000,
    });

    const originalTx = await MemoryDataStore.createTransaction(userId, {
      type: "expense",
      amount: 350,
      from_account_id: account.id,
      currency: "THB",
      transaction_date: "2026-09-10T00:00:00.000Z",
      description: "Lunch",
    });

    // Void
    const voidResult = await MemoryDataStore.voidTransaction(userId, originalTx.id, "Voiding lunch");
    expect(voidResult.transaction_id).toBe(originalTx.id);

    // Restore
    const restoreResult = await MemoryDataStore.restoreTransaction(userId, originalTx.id, "Unvoiding lunch");
    expect(restoreResult.transaction_id).toBe(originalTx.id);

    // Total transactions in DB must still be 1 (no new duplicate transaction created)
    const allTxs = await MemoryDataStore.getTransactionsIncludingVoided(userId);
    expect(allTxs.length).toBe(1);
    expect(allTxs[0].id).toBe(originalTx.id);
    expect(allTxs[0].voided_at).toBeNull();
  });

  // =========================================================================
  // Scenario 20: Audit history integrity across multiple cycles
  // =========================================================================
  it("Scenario 20: records complete chronological audit events across void -> restore -> void cycles", async () => {
    const account = await MemoryDataStore.createAccount(userId, {
      name: "Account",
      type: "bank",
      currency: "THB",
      opening_balance: 5000,
    });

    const tx = await MemoryDataStore.createTransaction(userId, {
      type: "income",
      amount: 4000,
      to_account_id: account.id,
      currency: "THB",
      transaction_date: "2026-09-10T00:00:00.000Z",
      description: "Consulting fee",
    });

    // 1. Void
    await MemoryDataStore.voidTransaction(userId, tx.id, "Wrong amount entered");

    // 2. Restore
    await MemoryDataStore.restoreTransaction(userId, tx.id, "Amount was actually correct");

    // 3. Void again
    await MemoryDataStore.voidTransaction(userId, tx.id, "Client canceled payment");

    const events = await MemoryDataStore.getTransactionVoidEvents(userId, tx.id);
    expect(events.length).toBe(3);

    expect(events[0].action).toBe("void");
    expect(events[0].reason).toBe("Wrong amount entered");
    expect(events[0].user_id).toBe(userId);

    expect(events[1].action).toBe("restore");
    expect(events[1].reason).toBe("Amount was actually correct");
    expect(events[1].user_id).toBe(userId);

    expect(events[2].action).toBe("void");
    expect(events[2].reason).toBe("Client canceled payment");
    expect(events[2].user_id).toBe(userId);
  });
});
