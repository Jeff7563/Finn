import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataStore } from "@/lib/server/data-store";

describe("Performance & Read Model Deduplication Suite", () => {
  const userId = "user-perf-test-123";

  beforeEach(() => {
    DataStore.reset();
  });

  it("DataStore.getTransactionsPageData returns all consolidated datasets in one call", async () => {
    // 1. Create relation records
    const account = await DataStore.createAccount(userId, {
      name: "Perf Checking",
      type: "bank",
      opening_balance: 10000,
      currency: "THB",
      active: true,
    });

    const category = await DataStore.createCategory(userId, {
      name: "Office Supplies",
      type: "expense",
    });

    const person = await DataStore.createPerson(userId, {
      display_name: "John Colleague",
      aliases: [],
    });

    const merchant = await DataStore.createMerchant(userId, {
      display_name: "Stationery Mart",
      aliases: [],
    });

    const tx = await DataStore.createTransaction(userId, {
      type: "expense",
      amount: 450,
      currency: "THB",
      from_account_id: account.id,
      category_id: category.id,
      person_id: person.id,
      merchant_id: merchant.id,
      transaction_date: "2026-09-15T09:00:00Z",
      description: "Notebooks",
      source: "manual",
    });

    // 2. Query page data
    const pageData = await DataStore.getTransactionsPageData(userId);

    expect(pageData.transactions).toHaveLength(1);
    expect(pageData.accounts).toHaveLength(1);
    expect(pageData.categories.some((c) => c.id === category.id)).toBe(true);
    expect(pageData.people).toHaveLength(1);
    expect(pageData.merchants).toHaveLength(1);

    // Verify relations are properly attached
    const retrievedTx = pageData.transactions[0];
    expect(retrievedTx.id).toBe(tx.id);
    expect(retrievedTx.from_account?.name).toBe("Perf Checking");
    expect(retrievedTx.category?.name).toBe("Office Supplies");
    expect(retrievedTx.person?.display_name).toBe("John Colleague");
    expect(retrievedTx.merchant?.display_name).toBe("Stationery Mart");
  });

  it("DataStore.getTransactions supports preloadedRelations to avoid repeated relation lookups", async () => {
    const account = await DataStore.createAccount(userId, {
      name: "Cash Wallet",
      type: "cash",
      opening_balance: 500,
      currency: "THB",
      active: true,
    });

    await DataStore.createTransaction(userId, {
      type: "expense",
      amount: 50,
      currency: "THB",
      from_account_id: account.id,
      transaction_date: "2026-09-15T09:30:00Z",
      description: "Coffee",
      source: "manual",
    });

    // Pass preloaded accounts directly
    const txs = await DataStore.getTransactions(userId, {
      accounts: [account],
      categories: [],
      people: [],
      merchants: [],
    });

    expect(txs).toHaveLength(1);
    expect(txs[0].from_account?.id).toBe(account.id);
  });

  it("DataStore.getTransactionById resolves single transaction with preloaded relations", async () => {
    const account = await DataStore.createAccount(userId, {
      name: "Savings",
      type: "bank",
      opening_balance: 2000,
      currency: "THB",
      active: true,
    });

    const tx = await DataStore.createTransaction(userId, {
      type: "income",
      amount: 1000,
      currency: "THB",
      to_account_id: account.id,
      transaction_date: "2026-09-15T09:45:00Z",
      description: "Interest",
      source: "manual",
    });

    const retrieved = await DataStore.getTransactionById(userId, tx.id, {
      accounts: [account],
    });

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(tx.id);
    expect(retrieved?.to_account?.name).toBe("Savings");
  });

  it("maintains strict cross-user privacy (no leakage between users)", async () => {
    const otherUserId = "user-intruder-456";

    await DataStore.createAccount(userId, {
      name: "Secret User Account",
      type: "bank",
      opening_balance: 50000,
      currency: "THB",
      active: true,
    });

    const intruderData = await DataStore.getTransactionsPageData(otherUserId);
    expect(intruderData.accounts).toHaveLength(0);
    expect(intruderData.transactions).toHaveLength(0);
  });
});
