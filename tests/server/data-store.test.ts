import { beforeEach, describe, expect, it } from "vitest";
import { DataStore } from "@/lib/server/data-store";
import { calculateAccountBalance } from "@/lib/finance/balances";

describe("DataStore & Integration Tests: Transactions & Ownership", () => {
  const userIdA = "user-alice-1111";
  const userIdB = "user-bob-2222";

  beforeEach(() => {
    DataStore.reset();
  });

  it("creates income and expense with account ownership validation", async () => {
    // 1. Create account for Alice
    const accountA = await DataStore.createAccount(userIdA, {
      name: "Alice Savings",
      type: "bank",
      opening_balance: 5000,
      currency: "THB",
      active: true,
      institution: "SCB",
      masked_number: "1111",
    });

    expect(accountA.id).toBeDefined();
    expect(accountA.user_id).toBe(userIdA);

    // 2. Create income for Alice
    const incomeTx = await DataStore.createTransaction(userIdA, {
      type: "income",
      amount: 15000,
      currency: "THB",
      to_account_id: accountA.id,
      transaction_date: "2026-09-01T10:00:00Z",
      description: "Salary income",
      source: "manual",
      tax_deductible: false,
    });

    expect(incomeTx.id).toBeDefined();
    expect(incomeTx.type).toBe("income");
    expect(incomeTx.amount).toBe(15000);

    // 3. Create expense for Alice
    const expenseTx = await DataStore.createTransaction(userIdA, {
      type: "expense",
      amount: 2500,
      currency: "THB",
      from_account_id: accountA.id,
      transaction_date: "2026-09-02T10:00:00Z",
      description: "Grocery shopping",
      source: "manual",
      tax_deductible: false,
    });

    expect(expenseTx.id).toBeDefined();
    expect(expenseTx.type).toBe("expense");

    // 4. Check account balance reconciliation
    const txs = await DataStore.getTransactions(userIdA);
    const balance = calculateAccountBalance(accountA, txs);
    // 5000 (opening) + 15000 (income) - 2500 (expense) = 17500
    expect(balance.current_balance).toBe(17500);
  });

  it("creates transfer between own accounts and prevents same-account transfer", async () => {
    const acc1 = await DataStore.createAccount(userIdA, {
      name: "SCB Account",
      type: "bank",
      opening_balance: 10000,
      currency: "THB",
      active: true,
    });

    const acc2 = await DataStore.createAccount(userIdA, {
      name: "KBank Account",
      type: "bank",
      opening_balance: 2000,
      currency: "THB",
      active: true,
    });

    // Transfer acc1 -> acc2 3,000
    const transferTx = await DataStore.createTransaction(userIdA, {
      type: "transfer",
      amount: 3000,
      from_account_id: acc1.id,
      to_account_id: acc2.id,
      transaction_date: "2026-09-03T10:00:00Z",
      currency: "THB",
      source: "manual",
      tax_deductible: false,
    });

    expect(transferTx.id).toBeDefined();
    expect(transferTx.type).toBe("transfer");

    const txs = await DataStore.getTransactions(userIdA);
    const bal1 = calculateAccountBalance(acc1, txs);
    const bal2 = calculateAccountBalance(acc2, txs);

    expect(bal1.current_balance).toBe(7000); // 10000 - 3000
    expect(bal2.current_balance).toBe(5000); // 2000 + 3000

    // Should reject transfer to the same account
    await expect(
      DataStore.createTransaction(userIdA, {
        type: "transfer",
        amount: 500,
        from_account_id: acc1.id,
        to_account_id: acc1.id,
        transaction_date: "2026-09-04T10:00:00Z",
        currency: "THB",
        source: "manual",
        tax_deductible: false,
      })
    ).rejects.toThrow();
  });

  it("strictly enforces account ownership and prevents foreign account hijacking", async () => {
    // Bob creates an account
    const bobAccount = await DataStore.createAccount(userIdB, {
      name: "Bob Secret Vault",
      type: "bank",
      opening_balance: 50000,
      currency: "THB",
      active: true,
    });

    // Alice tries to create an expense withdrawing from Bob's account
    await expect(
      DataStore.createTransaction(userIdA, {
        type: "expense",
        amount: 500,
        from_account_id: bobAccount.id, // Bob's account!
        transaction_date: "2026-09-01T10:00:00Z",
        currency: "THB",
        source: "manual",
        tax_deductible: false,
      })
    ).rejects.toThrow("Invalid source account");

    // Alice cannot see Bob's account
    const aliceAccounts = await DataStore.getAccounts(userIdA);
    expect(aliceAccounts.some((a) => a.id === bobAccount.id)).toBe(false);
  });

  it("supports updating and deleting transactions", async () => {
    const acc = await DataStore.createAccount(userIdA, {
      name: "Cash Wallet",
      type: "cash",
      opening_balance: 1000,
      currency: "THB",
      active: true,
    });

    const tx = await DataStore.createTransaction(userIdA, {
      type: "expense",
      amount: 200,
      from_account_id: acc.id,
      transaction_date: "2026-09-01T10:00:00Z",
      currency: "THB",
      description: "Coffee",
      source: "manual",
      tax_deductible: false,
    });

    // Update
    const updated = await DataStore.updateTransaction(userIdA, tx.id, {
      amount: 250,
      description: "Specialty Coffee",
    });
    expect(updated.amount).toBe(250);
    expect(updated.description).toBe("Specialty Coffee");

    // Delete
    await DataStore.deleteTransaction(userIdA, tx.id);
    const txs = await DataStore.getTransactions(userIdA);
    expect(txs.find((t) => t.id === tx.id)).toBeUndefined();
  });
});
