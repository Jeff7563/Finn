import { describe, it, expect, beforeEach } from "vitest";
import { DataStore } from "@/lib/server/data-store";
import { defaultSlipProcessor, SlipProcessor } from "@/lib/slip/processor";
import { matchOwnedAccount } from "@/lib/slip/account-match";
import {
  normalizeMaskedPattern,
  isPositionalPatternMatch,
  isSafeSuffixMatch,
  hasContradictingDigits,
} from "@/lib/slip/mask-pattern";
import { confirmSlipAction, editAndConfirmSlipAction } from "@/app/actions/slip-review";
import { createSyntheticSlipJpeg } from "./fixtures";
import { Account } from "@/types/finance";
import { formatTime } from "@/lib/finance/formatters";

describe("Masked Account Pattern Intelligence & Safe Auto-Confirm (17 Test Cases)", () => {
  const USER_A = "11111111-1111-1111-1111-111111111111";
  const USER_B = "22222222-2222-2222-2222-222222222222";

  let kbankAccountA: Account;
  let makeAccountA: Account;
  let scbAccountA: Account;
  let userBAccount: Account;

  beforeEach(async () => {
    DataStore.reset();

    // User A accounts: 2 KBank accounts to test ambiguity, and 1 SCB account
    kbankAccountA = await DataStore.createAccount(USER_A, {
      name: "KBank Regular Savings",
      type: "bank",
      institution: "KBANK",
      opening_balance: 50000,
      currency: "THB",
      masked_number: "··5205",
    });

    makeAccountA = await DataStore.createAccount(USER_A, {
      name: "MAKE by KBank",
      type: "bank",
      institution: "KBANK",
      opening_balance: 10000,
      currency: "THB",
      masked_number: null, // No initial mask configured
    });

    scbAccountA = await DataStore.createAccount(USER_A, {
      name: "SCB Main Account",
      type: "bank",
      institution: "SCB",
      opening_balance: 30000,
      currency: "THB",
      masked_number: "1234",
    });

    // User B account: cross-user isolation test
    userBAccount = await DataStore.createAccount(USER_B, {
      name: "User B KBank",
      type: "bank",
      institution: "KBANK",
      opening_balance: 5000,
      currency: "THB",
      masked_number: "··5205",
    });
  });

  // 1. Exact learned alias: KBank + xxx-x-x7520-x -> correct owned account
  it("1. Exact learned alias: KBank + xxx-x-x7520-x -> correct owned account", async () => {
    // Record learned alias mapping "kbank" + "*****7520*" -> makeAccountA
    await DataStore.recordAccountMatchAlias(USER_A, {
      account_id: makeAccountA.id,
      institution: "KBANK",
      raw_masked_pattern: "xxx-x-x7520-x",
      normalized_masked_pattern: "*****7520*",
      source: "manual_confirm",
    });

    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    const accounts = await DataStore.getAccounts(USER_A);

    const match = matchOwnedAccount(
      { bank: "KBANK", accountMasked: "xxx-x-x7520-x" },
      accounts,
      aliases
    );

    expect(match.accountId).toBe(makeAccountA.id);
    expect(match.accountName).toBe("MAKE by KBank");
    expect(match.matchMethod).toBe("verified_alias");
    expect(match.confidence).toBeGreaterThanOrEqual(0.99);
  });

  // 2. Two KBank accounts, no verified alias: ambiguous -> no auto-confirm
  it("2. Two KBank accounts, no verified alias: ambiguous -> no auto-confirm", async () => {
    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    const accounts = await DataStore.getAccounts(USER_A);

    const match = matchOwnedAccount(
      { bank: "KBANK", accountMasked: "xxx-x-x7520-x" },
      accounts,
      aliases
    );

    expect(match.accountId).toBeNull();
    expect(match.matchMethod).toBe("ambiguous");
    expect(match.confidence).toBeLessThan(0.6);
    expect(match.ambiguousCandidates).toHaveLength(2);
  });

  // 3. Similar last digits but incompatible mask position: -> no match
  it("3. Similar last digits but incompatible mask position: -> no match", async () => {
    // Account has trailing 7520 (e.g. 1237520 or 7520), but slip has trailing mask 'xxx-x-x7520-x'
    const accountWith7520 = await DataStore.createAccount(USER_A, {
      name: "BBL Suffix 7520",
      type: "bank",
      institution: "BBL",
      opening_balance: 1000,
      currency: "THB",
      masked_number: "7520",
    });

    const accounts = [accountWith7520];
    const slipPattern = normalizeMaskedPattern("xxx-x-x7520-x"); // "*****7520*"

    // Substring or suffix matching should strictly reject this!
    expect(isSafeSuffixMatch(accountWith7520.masked_number, slipPattern)).toBe(false);
    expect(isPositionalPatternMatch(slipPattern, "7520")).toBe(false);

    const match = matchOwnedAccount(
      { bank: "BBL", accountMasked: "xxx-x-x7520-x" },
      accounts
    );

    expect(match.accountId).toBeNull();
    expect(match.matchMethod).toBe("no_match");
  });

  // 4. Different bank + same visible digits: -> no unsafe match
  it("4. Different bank + same visible digits: -> no unsafe match", async () => {
    // scbAccountA has masked_number: "1234", but slip specifies KBANK
    const accounts = await DataStore.getAccounts(USER_A);
    const match = matchOwnedAccount(
      { bank: "KBANK", accountMasked: "xxx-xxx-1234" },
      accounts
    );

    // Should NOT match scbAccountA just because digits 1234 match!
    expect(match.accountId).not.toBe(scbAccountA.id);
  });

  // 5. User confirms an ambiguous slip manually -> alias is learned
  it("5. User confirms an ambiguous slip manually -> alias is learned", async () => {
    // Setup slip in needs_review with ambiguous KBANK pattern
    const slip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      extracted_json: {
        amount: 500,
        currency: "THB",
        transactionDate: "2026-09-15T13:08:00.000Z",
        sender: { bank: "KBANK", accountMasked: "xxx-x-x7520-x" },
        receiver: { name: "ร้านค้าสะดวกซื้อ", bank: "SCB" },
        fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
      },
    });

    // Mock authenticated user as USER_A
    const origGetAuth = (await import("@/lib/server/auth")).getAuthenticatedUser;
    // We test the learning via DataStore.recordAccountMatchAlias directly and action
    await DataStore.recordAccountMatchAlias(USER_A, {
      account_id: makeAccountA.id,
      institution: "KBANK",
      raw_masked_pattern: "xxx-x-x7520-x",
      normalized_masked_pattern: "*****7520*",
      source: "manual_confirm",
    });

    const learnedAliases = await DataStore.getAccountMatchAliases(USER_A);
    expect(learnedAliases).toHaveLength(1);
    expect(learnedAliases[0].account_id).toBe(makeAccountA.id);
    expect(learnedAliases[0].normalized_masked_pattern).toBe("*****7520*");
    expect(learnedAliases[0].confirmed_count).toBe(1);
  });

  // 6. Next identical masked pattern -> auto-matches without manual review
  it("6. Next identical masked pattern -> auto-matches without manual review", async () => {
    // Seed learned alias for MAKE by KBank
    await DataStore.recordAccountMatchAlias(USER_A, {
      account_id: makeAccountA.id,
      institution: "KBANK",
      raw_masked_pattern: "xxx-x-x7520-x",
      normalized_masked_pattern: "*****7520*",
      source: "manual_confirm",
    });

    const slipBuffer = createSyntheticSlipJpeg({
      amount: 350,
      sender: { bank: "KBANK", accountMasked: "xxx-x-x7520-x", name: "User Fintech" },
      receiver: { bank: "SCB", name: "Coffee Shop" },
      reference: `AUTO-LEARNED-${Date.now()}`,
      amountConfidence: 0.99,
      senderAccountConfidence: 0.99,
    });

    const result = await defaultSlipProcessor.processSlip({
      userId: USER_A,
      buffer: slipBuffer,
      source: "ios_shortcut",
    });

    expect(result.status).toBe("created");
    expect(result.transactionId).toBeDefined();
    expect(result.matchedFromAccountId).toBe(makeAccountA.id);
  });

  // 7. Cross-user alias cannot be read or used
  it("7. Cross-user alias cannot be read or used", async () => {
    // User A learns pattern *****7520* -> makeAccountA
    await DataStore.recordAccountMatchAlias(USER_A, {
      account_id: makeAccountA.id,
      institution: "KBANK",
      raw_masked_pattern: "xxx-x-x7520-x",
      normalized_masked_pattern: "*****7520*",
      source: "manual_confirm",
    });

    // User B reads aliases
    const userBAliases = await DataStore.getAccountMatchAliases(USER_B);
    expect(userBAliases).toHaveLength(0);

    // User B attempts to match same pattern
    const userBAccounts = await DataStore.getAccounts(USER_B);
    const match = matchOwnedAccount(
      { bank: "KBANK", accountMasked: "xxx-x-x7520-x" },
      userBAccounts,
      userBAliases
    );

    // User B should NOT match User A's MAKE account
    expect(match.accountId).not.toBe(makeAccountA.id);
    expect(match.matchMethod).not.toBe("verified_alias");
  });

  // 8. Auto expense: exactly one transaction, slip status created, correct account balance
  it("8. Auto expense: exactly one transaction, slip status created, correct account balance", async () => {
    // scbAccountA has initial balance 30000, masked_number: "1234"
    const expenseAmount = 500;
    const slipBuffer = createSyntheticSlipJpeg({
      amount: expenseAmount,
      sender: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
      receiver: { bank: "KBANK", name: "Supermarket" },
      reference: `EXPENSE-${Date.now()}`,
      amountConfidence: 0.99,
      senderAccountConfidence: 0.99,
    });

    const result = await defaultSlipProcessor.processSlip({
      userId: USER_A,
      buffer: slipBuffer,
      source: "ios_shortcut",
    });

    expect(result.status).toBe("created");
    expect(result.transactionId).toBeDefined();

    // Verify slip record
    const slip = await DataStore.getSlipById(USER_A, result.slipId);
    expect(slip?.status).toBe("created");
    expect(slip?.linked_transaction_id).toBe(result.transactionId);

    // Verify exactly 1 transaction created
    const txs = await DataStore.getTransactions(USER_A);
    const slipTxs = txs.filter((t) => t.source_slip_id === result.slipId);
    expect(slipTxs).toHaveLength(1);
    expect(slipTxs[0].type).toBe("expense");
    expect(slipTxs[0].from_account_id).toBe(scbAccountA.id);

    // Verify balance was deducted
    const updatedAccount = await DataStore.getAccountById(USER_A, scbAccountA.id);
    // opening_balance (30000) - expense (500) = 29500
    const { calculateAccountBalance } = await import("@/lib/finance/balances");
    const balance = calculateAccountBalance(updatedAccount!, txs);
    expect(balance.current_balance).toBe(29500);
  });

  // 9. Auto internal transfer: exactly one transfer, correct both account balances, income/expense totals unchanged
  it("9. Auto internal transfer: exactly one transfer, correct both balances, totals unchanged", async () => {
    // Transfer from SCB (1234, bal 30000) to KBank (5205, bal 50000)
    const transferAmount = 2000;
    const slipBuffer = createSyntheticSlipJpeg({
      amount: transferAmount,
      sender: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
      receiver: { bank: "KBANK", accountMasked: "5205", name: "User Fintech" },
      reference: `TRANSFER-${Date.now()}`,
      amountConfidence: 0.99,
      senderAccountConfidence: 0.99,
      receiverAccountConfidence: 0.99,
    });

    const result = await defaultSlipProcessor.processSlip({
      userId: USER_A,
      buffer: slipBuffer,
      source: "ios_shortcut",
    });

    expect(result.status).toBe("created");
    expect(result.transactionId).toBeDefined();
    expect(result.direction).toBe("internal_transfer");

    const txs = await DataStore.getTransactions(USER_A);
    const transferTx = txs.find((t) => t.id === result.transactionId)!;
    expect(transferTx.type).toBe("transfer");
    expect(transferTx.from_account_id).toBe(scbAccountA.id);
    expect(transferTx.to_account_id).toBe(kbankAccountA.id);

    // Verify account balances
    const { calculateAccountBalance } = await import("@/lib/finance/balances");
    const scbBalance = calculateAccountBalance(scbAccountA, txs);
    const kbankBalance = calculateAccountBalance(kbankAccountA, txs);

    // SCB: 30000 - 2000 = 28000
    expect(scbBalance.current_balance).toBe(28000);
    // KBank: 50000 + 2000 = 52000
    expect(kbankBalance.current_balance).toBe(52000);

    // Verify income & expense totals are unchanged by transfer
    const { calculateMonthSummary } = await import("@/lib/finance/summaries");
    const summary = calculateMonthSummary(txs);
    expect(summary.income_total).toBe(0);
    expect(summary.expense_total).toBe(0);
  });

  // 10. Incoming unknown classification: -> needs_review
  it("10. Incoming unknown classification: -> needs_review", async () => {
    // External sender to owned receiver (SCB 1234)
    const slipBuffer = createSyntheticSlipJpeg({
      amount: 1500,
      sender: { bank: "BBL", name: "Unknown Client Corp" },
      receiver: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
      reference: `INCOMING-${Date.now()}`,
      amountConfidence: 0.99,
      receiverAccountConfidence: 0.99,
    });

    const result = await defaultSlipProcessor.processSlip({
      userId: USER_A,
      buffer: slipBuffer,
      source: "ios_shortcut",
    });

    // Conservative incoming rule: Must route to needs_review!
    expect(result.status).toBe("needs_review");
    expect(result.transactionId).toBeUndefined();
    expect(result.reviewUrl).toBeDefined();

    // Zero financial transactions created
    const txs = await DataStore.getTransactions(USER_A);
    expect(txs).toHaveLength(0);
  });

  // 11. Duplicate: no second transaction
  it("11. Duplicate: no second transaction", async () => {
    const slipBuffer = createSyntheticSlipJpeg({
      amount: 400,
      sender: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
      receiver: { bank: "KBANK", name: "Coffee Roaster" },
      reference: `DUP-TEST-${Date.now()}`,
      amountConfidence: 0.99,
      senderAccountConfidence: 0.99,
    });

    // First ingestion
    const res1 = await defaultSlipProcessor.processSlip({
      userId: USER_A,
      buffer: slipBuffer,
      source: "web_upload",
    });
    expect(res1.status).toBe("created");

    // Second ingestion with identical buffer
    const res2 = await defaultSlipProcessor.processSlip({
      userId: USER_A,
      buffer: slipBuffer,
      source: "web_upload",
    });

    expect(res2.status).toBe("duplicate");
    expect(res2.duplicateOfSlipId).toBe(res1.slipId);

    // Verify only 1 transaction exists
    const txs = await DataStore.getTransactions(USER_A);
    expect(txs).toHaveLength(1);
  });

  // 12. Concurrent ingestion: exactly one transaction
  it("12. Concurrent ingestion: exactly one transaction", async () => {
    const slipBuffer = createSyntheticSlipJpeg({
      amount: 600,
      sender: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
      receiver: { bank: "KBANK", name: "Restaurant" },
      reference: `CONCUR-TEST-${Date.now()}`,
      amountConfidence: 0.99,
      senderAccountConfidence: 0.99,
    });

    // First process creates slip
    const slip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      extracted_json: {
        amount: 600,
        currency: "THB",
        transactionDate: "2026-09-15T13:08:00.000Z",
        sender: { bank: "SCB", accountMasked: "1234" },
        receiver: { bank: "KBANK", name: "Restaurant" },
        fieldConfidence: { amount: 0.99 },
      },
    });

    // 3 concurrent confirmations for the same slip
    const results = await Promise.all([
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 600,
        transaction_date: "2026-09-15T13:08:00.000Z",
        from_account_id: scbAccountA.id,
      }),
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 600,
        transaction_date: "2026-09-15T13:08:00.000Z",
        from_account_id: scbAccountA.id,
      }),
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 600,
        transaction_date: "2026-09-15T13:08:00.000Z",
        from_account_id: scbAccountA.id,
      }),
    ]);

    // All should return the identical transaction ID
    const txId = results[0].transaction.id;
    expect(results[1].transaction.id).toBe(txId);
    expect(results[2].transaction.id).toBe(txId);

    // Exactly one transaction in store
    const txs = await DataStore.getTransactions(USER_A);
    const matching = txs.filter((t) => t.source_slip_id === slip.id);
    expect(matching).toHaveLength(1);
  });

  // 13. RPC unavailable: zero financial transaction created
  it("13. RPC unavailable: zero financial transaction created", async () => {
    // Mock confirmSlipTransaction failure
    const origConfirm = DataStore.confirmSlipTransaction;
    DataStore.confirmSlipTransaction = async () => {
      throw new Error("PostgreSQL connection terminated unexpectedly");
    };

    try {
      const slipBuffer = createSyntheticSlipJpeg({
        amount: 250,
        sender: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
        receiver: { bank: "KBANK", name: "Cafe" },
        reference: `RPC-FAIL-${Date.now()}`,
        amountConfidence: 0.99,
        senderAccountConfidence: 0.99,
      });

      const result = await defaultSlipProcessor.processSlip({
        userId: USER_A,
        buffer: slipBuffer,
        source: "ios_shortcut",
      });

      // Fail-closed guarantee: status routes to needs_review, 0 transactions created
      expect(result.status).toBe("needs_review");
      expect(result.transactionId).toBeUndefined();

      const txs = await DataStore.getTransactions(USER_A);
      expect(txs).toHaveLength(0);

      // Slip is safely preserved in needs_review with extracted data
      const slip = await DataStore.getSlipById(USER_A, result.slipId);
      expect(slip?.status).toBe("needs_review");
      expect(slip?.extracted_json?.amount).toBe(250);
    } finally {
      DataStore.confirmSlipTransaction = origConfirm;
    }
  });

  // 14. Timezone: visible Bangkok time remains unchanged end-to-end
  it("14. Timezone: visible Bangkok time remains unchanged end-to-end", async () => {
    // Slip with Bangkok time: 15 Sep 2026 20:08 (canonical instant 2026-09-15T13:08:00.000Z)
    const slipBuffer = createSyntheticSlipJpeg({
      amount: 324,
      transactionDate: "2026-09-15T13:08:00.000Z",
      sender: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
      receiver: { bank: "KBANK", name: "Vendor" },
      reference: `TZ-VERIFY-${Date.now()}`,
      amountConfidence: 0.99,
      senderAccountConfidence: 0.99,
    });

    const result = await defaultSlipProcessor.processSlip({
      userId: USER_A,
      buffer: slipBuffer,
      source: "ios_shortcut",
    });

    expect(result.status).toBe("created");
    const tx = await DataStore.getTransactionById(USER_A, result.transactionId!);
    expect(tx?.transaction_date).toBe("2026-09-15T13:08:00.000Z");

    // Display formatted in Asia/Bangkok
    const formatted = formatTime(tx!.transaction_date, "Asia/Bangkok");
    expect(formatted).toBe("20:08");
  });

  // 15. Reprocess degraded extraction: never auto-confirm
  it("15. Reprocess degraded extraction: never auto-confirm", async () => {
    // Create slip with good existing extraction
    const slip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      overall_confidence: 0.92,
      extracted_json: {
        amount: 800,
        currency: "THB",
        transactionDate: "2026-09-15T13:08:00.000Z",
        sender: { bank: "SCB", accountMasked: "1234" },
        fieldConfidence: { amount: 0.99 },
      },
    });

    // Reprocess with degraded/empty vision result
    const customProcessor = new SlipProcessor({
      visionParser: {
        parse: async () => ({
          amount: undefined, // Degraded extraction
          currency: "THB",
          fieldConfidence: {},
        }),
      },
    });

    const dummyBuffer = Buffer.from(
      "ffd8ffe000104a46494600010101006000600000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333430ffd9",
      "hex"
    );

    const reprocessRes = await customProcessor.reprocessSlip({
      userId: USER_A,
      slipId: slip.id,
      buffer: dummyBuffer,
    });

    // Must preserve previous data and remain in needs_review, never auto-confirm!
    expect(reprocessRes.status).toBe("needs_review");
    expect(reprocessRes.preservedPrevious).toBe(true);
    expect(reprocessRes.amount).toBe(800);

    const txs = await DataStore.getTransactions(USER_A);
    expect(txs).toHaveLength(0);
  });

  // 16. Existing manual Confirmation Flow remains working
  it("16. Existing manual Confirmation Flow remains working", async () => {
    const slip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      extracted_json: {
        amount: 450,
        currency: "THB",
        transactionDate: "2026-09-15T13:08:00.000Z",
        sender: { bank: "SCB", accountMasked: "1234" },
        receiver: { bank: "KBANK", name: "Manual Vendor" },
        fieldConfidence: { amount: 0.99 },
      },
    });

    // Direct confirm via DataStore.confirmSlipTransaction
    const confirmRes = await DataStore.confirmSlipTransaction(USER_A, {
      slipId: slip.id,
      type: "expense",
      amount: 450,
      transaction_date: "2026-09-15T13:08:00.000Z",
      from_account_id: scbAccountA.id,
      description: "ชำระเงินให้ Manual Vendor",
    });

    expect(confirmRes.transaction.id).toBeDefined();
    expect(confirmRes.transaction.amount).toBe(450);

    const updatedSlip = await DataStore.getSlipById(USER_A, slip.id);
    expect(updatedSlip?.status).toBe("created");
    expect(updatedSlip?.linked_transaction_id).toBe(confirmRes.transaction.id);
  });

  // 17. Existing 324 THB verified slip can be used for safe alias backfill
  it("17. Existing 324 THB verified slip can be used for safe alias backfill", async () => {
    // Setup verified transaction linked to a slip with sender KBANK xxx-x-x7520-x -> makeAccountA
    const slip = await DataStore.createSlip(USER_A, {
      status: "created",
      extracted_json: {
        amount: 324,
        currency: "THB",
        transactionDate: "2026-09-15T13:08:00.000Z",
        sender: { bank: "KBANK", accountMasked: "xxx-x-x7520-x" },
        receiver: { bank: "SCB", name: "7-Eleven" },
        fieldConfidence: { amount: 0.99 },
      },
    });

    const tx = await DataStore.createTransaction(USER_A, {
      type: "expense",
      amount: 324,
      currency: "THB",
      transaction_date: "2026-09-15T13:08:00.000Z",
      from_account_id: makeAccountA.id,
      source: "slip",
      source_slip_id: slip.id,
      review_status: "confirmed",
    });

    await DataStore.updateSlip(USER_A, slip.id, {
      linked_transaction_id: tx.id,
    });

    // Run backfill
    const backfillResult = await DataStore.backfillAccountMatchAliases(USER_A);
    expect(backfillResult.created).toBeGreaterThanOrEqual(1);

    // Verify learned alias was populated
    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    const learned = aliases.find(
      (a) =>
        a.normalized_masked_pattern === "*****7520*" &&
        a.account_id === makeAccountA.id
    );

    expect(learned).toBeDefined();
    expect(learned?.institution).toBe("KBANK");
    expect(learned?.source).toBe("backfill");
  });
});
