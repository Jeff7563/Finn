import { describe, it, expect, beforeEach } from "vitest";
import { DataStore } from "@/lib/server/data-store";
import {
  signSessionPayload,
  verifySessionToken,
  DEMO_USER_ID,
  DEMO_USER,
} from "@/lib/server/session";
import {
  accountSchema,
  transactionSchema,
  MAX_MONEY_AMOUNT,
} from "@/lib/validation/schemas";

describe("Finn Phase 1 Adversarial Security Test Suite", () => {
  const USER_A = "user-a-1111-1111";
  const USER_B = "user-b-2222-2222";

  let userAAccount: { id: string };
  let userBAccount: { id: string };
  let userBCategory: { id: string };
  let userBPerson: { id: string };
  let userBMerchant: { id: string };
  let userBTransaction: { id: string };

  beforeEach(async () => {
    // Reset DataStore with fresh state
    DataStore.reset();

    // Setup User A baseline account
    userAAccount = await DataStore.createAccount(USER_A, {
      name: "User A SCB Account",
      type: "bank",
      opening_balance: 10000,
    });

    // Setup User B baseline account, category, person, merchant, and transaction
    userBAccount = await DataStore.createAccount(USER_B, {
      name: "User B Secret Private Vault",
      type: "bank",
      opening_balance: 500000,
    });

    userBCategory = await DataStore.createCategory(USER_B, {
      name: "User B Private Category",
      type: "expense",
    });

    userBPerson = await DataStore.createPerson(USER_B, {
      display_name: "User B Private Contact",
      aliases: [],
    });

    userBMerchant = await DataStore.createMerchant(USER_B, {
      display_name: "User B Private Vendor",
      aliases: [],
    });

    userBTransaction = await DataStore.createTransaction(USER_B, {
      type: "expense",
      amount: 5000,
      from_account_id: userBAccount.id,
      category_id: userBCategory.id,
      person_id: userBPerson.id,
      merchant_id: userBMerchant.id,
      transaction_date: new Date().toISOString(),
      description: "User B confidential expense",
    });
  });

  // 1. User A cannot read User B account
  it("1. User A cannot read User B account", async () => {
    const userAAccounts = await DataStore.getAccounts(USER_A);
    expect(userAAccounts.some((a) => a.id === userBAccount.id)).toBe(false);

    const directLookup = await DataStore.getAccountById(USER_A, userBAccount.id);
    expect(directLookup).toBeNull();
  });

  // 2. User A cannot read User B transaction
  it("2. User A cannot read User B transaction", async () => {
    const userATxs = await DataStore.getTransactions(USER_A);
    expect(userATxs.some((t) => t.id === userBTransaction.id)).toBe(false);

    const directLookup = await DataStore.getTransactionById(
      USER_A,
      userBTransaction.id
    );
    expect(directLookup).toBeNull();
  });

  // 3. User A cannot update User B transaction
  it("3. User A cannot update User B transaction", async () => {
    await expect(
      DataStore.updateTransaction(USER_A, userBTransaction.id, {
        description: "Malicious modification by User A",
        amount: 999,
      })
    ).rejects.toThrow(/not found or access denied/i);

    // Verify record remains untouched
    const tx = await DataStore.getTransactionById(USER_B, userBTransaction.id);
    expect(tx?.description).toBe("User B confidential expense");
    expect(tx?.amount).toBe(5000);
  });

  // 4. User A cannot delete User B transaction
  it("4. User A cannot delete User B transaction", async () => {
    await expect(
      DataStore.deleteTransaction(USER_A, userBTransaction.id)
    ).rejects.toThrow(/not found or access denied/i);

    const tx = await DataStore.getTransactionById(USER_B, userBTransaction.id);
    expect(tx).not.toBeNull();
  });

  // 5. User A cannot use User B source account
  it("5. User A cannot use User B source account (foreign key attack)", async () => {
    await expect(
      DataStore.createTransaction(USER_A, {
        type: "expense",
        amount: 100,
        from_account_id: userBAccount.id, // User B's account
        transaction_date: new Date().toISOString(),
      })
    ).rejects.toThrow(/invalid source account|access denied/i);
  });

  // 6. User A cannot use User B destination account
  it("6. User A cannot use User B destination account (foreign key attack)", async () => {
    await expect(
      DataStore.createTransaction(USER_A, {
        type: "transfer",
        amount: 100,
        from_account_id: userAAccount.id,
        to_account_id: userBAccount.id, // User B's account
        transaction_date: new Date().toISOString(),
      })
    ).rejects.toThrow(/invalid destination account|access denied/i);
  });

  // 7. User A cannot use User B category
  it("7. User A cannot use User B category (foreign key attack)", async () => {
    await expect(
      DataStore.createTransaction(USER_A, {
        type: "expense",
        amount: 100,
        from_account_id: userAAccount.id,
        category_id: userBCategory.id, // User B's private custom category
        transaction_date: new Date().toISOString(),
      })
    ).rejects.toThrow(/invalid category|access denied/i);
  });

  // 8. User A cannot use User B person
  it("8. User A cannot use User B person (foreign key attack)", async () => {
    await expect(
      DataStore.createTransaction(USER_A, {
        type: "expense",
        amount: 100,
        from_account_id: userAAccount.id,
        person_id: userBPerson.id, // User B's contact
        transaction_date: new Date().toISOString(),
      })
    ).rejects.toThrow(/invalid counterparty person|access denied/i);
  });

  // 9. User A cannot use User B merchant
  it("9. User A cannot use User B merchant (foreign key attack)", async () => {
    await expect(
      DataStore.createTransaction(USER_A, {
        type: "expense",
        amount: 100,
        from_account_id: userAAccount.id,
        merchant_id: userBMerchant.id, // User B's merchant
        transaction_date: new Date().toISOString(),
      })
    ).rejects.toThrow(/invalid merchant|access denied/i);
  });

  // 10. Unauthenticated mutation / empty user ID is rejected
  it("10. Unauthenticated mutation rejected", async () => {
    await expect(
      DataStore.createAccount("", {
        name: "Anonymous Account",
        type: "bank",
      })
    ).rejects.toThrow(/authentication required/i);

    await expect(
      DataStore.getAccounts("")
    ).rejects.toThrow(/authentication required/i);
  });

  // 11. Invalid amount rejected (negative, zero, NaN, Infinity, overflow)
  it("11. Invalid amount rejected by schema and store", async () => {
    // Negative amount
    const negRes = transactionSchema.safeParse({
      type: "expense",
      amount: -500,
      transaction_date: new Date().toISOString(),
    });
    expect(negRes.success).toBe(false);

    // Zero amount
    const zeroRes = transactionSchema.safeParse({
      type: "expense",
      amount: 0,
      transaction_date: new Date().toISOString(),
    });
    expect(zeroRes.success).toBe(false);

    // Infinity
    const infRes = transactionSchema.safeParse({
      type: "expense",
      amount: Infinity,
      transaction_date: new Date().toISOString(),
    });
    expect(infRes.success).toBe(false);

    // NaN
    const nanRes = transactionSchema.safeParse({
      type: "expense",
      amount: "not-a-number",
      transaction_date: new Date().toISOString(),
    });
    expect(nanRes.success).toBe(false);

    // Overflow beyond NUMERIC(14,2)
    const overflowRes = transactionSchema.safeParse({
      type: "expense",
      amount: MAX_MONEY_AMOUNT + 1000,
      transaction_date: new Date().toISOString(),
    });
    expect(overflowRes.success).toBe(false);

    // DataStore rejection of non-finite/negative amounts
    await expect(
      DataStore.createTransaction(USER_A, {
        type: "expense",
        amount: -50,
        from_account_id: userAAccount.id,
        transaction_date: new Date().toISOString(),
      })
    ).rejects.toThrow(/positive finite number/i);
  });

  // 12. Same-account transfer rejected
  it("12. Same-account transfer rejected", async () => {
    const sameAccRes = transactionSchema.safeParse({
      type: "transfer",
      amount: 500,
      from_account_id: userAAccount.id,
      to_account_id: userAAccount.id, // identical
      transaction_date: new Date().toISOString(),
    });
    expect(sameAccRes.success).toBe(false);
    expect(sameAccRes.error?.issues[0]?.message).toMatch(
      /different source and destination/i
    );

    // DataStore enforcement
    await expect(
      DataStore.createTransaction(USER_A, {
        type: "transfer",
        amount: 500,
        from_account_id: userAAccount.id,
        to_account_id: userAAccount.id,
        transaction_date: new Date().toISOString(),
      })
    ).rejects.toThrow(/must not be identical/i);
  });

  // 13. Demo user cannot access another user's real records
  it("13. Demo user cannot access another user's real records", async () => {
    const demoAccounts = await DataStore.getAccounts(DEMO_USER_ID);
    expect(demoAccounts.some((a) => a.id === userBAccount.id)).toBe(false);

    const demoTxs = await DataStore.getTransactions(DEMO_USER_ID);
    expect(demoTxs.some((t) => t.id === userBTransaction.id)).toBe(false);

    await expect(
      DataStore.updateTransaction(DEMO_USER_ID, userBTransaction.id, {
        description: "Demo tamper attempt",
      })
    ).rejects.toThrow(/not found or access denied/i);

    await expect(
      DataStore.deleteTransaction(DEMO_USER_ID, userBTransaction.id)
    ).rejects.toThrow(/not found or access denied/i);
  });

  // 14. Session cryptographic verification rejects forged cookies
  it("14. Session cryptographic verification rejects forged or tampered cookies", async () => {
    // Malicious unsigned JSON impersonating user B
    const forgedRawJson = JSON.stringify({
      id: USER_B,
      email: "victim@victim.com",
    });
    expect(await verifySessionToken(forgedRawJson)).toBeNull();

    // Valid signed session for User A
    const validToken = await signSessionPayload({
      id: USER_A,
      email: "user_a@finn.local",
    });
    const parsed = await verifySessionToken(validToken);
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(USER_A);

    // Tampered token (changed data segment)
    const [b64, sig] = validToken.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ id: USER_B, email: "tampered@test.com" })
    ).toString("base64url");
    const tamperedToken = `${tamperedPayload}.${sig}`;

    expect(await verifySessionToken(tamperedToken)).toBeNull();
  });
});
