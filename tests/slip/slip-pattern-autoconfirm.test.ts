import { describe, it, expect, beforeEach } from "vitest";
import { DataStore } from "@/lib/server/data-store";
import { defaultSlipProcessor, SlipProcessor } from "@/lib/slip/processor";
import { matchOwnedAccount } from "@/lib/slip/account-match";
import {
  normalizeMaskedPattern,
  isPositionalPatternMatch,
  countSharedPositionalDigits,
  isSafeSuffixMatch,
  hasContradictingDigits,
  hasSufficientVisibleDigits,
  countVisibleDigits,
} from "@/lib/slip/mask-pattern";
import { evaluateConfidence } from "@/lib/slip/confidence";
import { createSyntheticSlipJpeg } from "./fixtures";
import { Account } from "@/types/finance";
import { formatTime } from "@/lib/finance/formatters";

describe("Masked Account Pattern Intelligence & Safe Auto-Confirm Hardening (15 Required Scenarios)", () => {
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

  // 1. known KBANK + only SCB same pattern -> no_match
  it("1. known KBANK + only SCB same pattern -> no_match", async () => {
    // User has only SCB account with 1234. Slip is explicitly KBANK with ****1234.
    const scbOnlyAccounts = [scbAccountA];
    const match = matchOwnedAccount(
      { bank: "KBANK", accountMasked: "xxx-xxx-1234" },
      scbOnlyAccounts
    );

    // Rule: Never positionally or suffix match across a known different bank!
    expect(match.accountId).toBeNull();
    expect(match.matchMethod).toBe("no_match");
    expect(match.confidence).toBe(0);
  });

  // 2. bank_only never auto-confirms
  it("2. bank_only never auto-confirms", async () => {
    // Single SCB account in accounts list
    const scbOnlyAccounts = [scbAccountA];
    const match = matchOwnedAccount(
      { bank: "SCB" },
      scbOnlyAccounts
    );

    expect(match.accountId).toBe(scbAccountA.id);
    expect(match.matchMethod).toBe("bank_only");
    // Confidence MUST remain strictly below auto-confirm threshold (0.95)
    expect(match.confidence).toBeLessThanOrEqual(0.70);

    // Evaluate confidence: bank_only is NOT in AUTOCONFIRM_SAFE_MATCH_METHODS
    const decision = evaluateConfidence({
      amount: 500,
      transactionDate: "2026-09-15T13:08:00.000Z",
      direction: "outgoing",
      directionRequiresReview: false,
      senderAccountId: match.accountId,
      senderAccountConfidence: match.confidence,
      senderMatchMethod: match.matchMethod,
      fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
    });

    expect(decision.canAutoCreate).toBe(false);
    expect(decision.status).toBe("needs_review");
  });

  // 3. 1 shared positional digit never auto-confirms
  it("3. 1 shared positional digit never auto-confirms", async () => {
    const accWithOneDigit = await DataStore.createAccount(USER_A, {
      name: "KBank One Digit",
      type: "bank",
      institution: "KBANK",
      opening_balance: 1000,
      currency: "THB",
      masked_number: "*********4", // 1 visible digit
    });

    const match = matchOwnedAccount(
      { bank: "KBANK", accountMasked: "*********4" },
      [accWithOneDigit]
    );

    expect(match.accountId).toBe(accWithOneDigit.id);
    expect(match.matchMethod).toBe("weak_pattern_match");
    expect(match.sharedDigits).toBe(1);
    expect(match.confidence).toBeLessThanOrEqual(0.70);

    const decision = evaluateConfidence({
      amount: 300,
      transactionDate: "2026-09-15T13:08:00.000Z",
      direction: "outgoing",
      directionRequiresReview: false,
      senderAccountId: match.accountId,
      senderAccountConfidence: match.confidence,
      senderMatchMethod: match.matchMethod,
      fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
    });

    expect(decision.canAutoCreate).toBe(false);
    expect(decision.status).toBe("needs_review");
  });

  // 4. 2 shared digits never auto-confirms
  it("4. 2 shared digits never auto-confirms", async () => {
    const accWithTwoDigits = await DataStore.createAccount(USER_A, {
      name: "KBank Two Digits",
      type: "bank",
      institution: "KBANK",
      opening_balance: 1000,
      currency: "THB",
      masked_number: "********34", // 2 visible digits
    });

    const match = matchOwnedAccount(
      { bank: "KBANK", accountMasked: "********34" },
      [accWithTwoDigits]
    );

    expect(match.accountId).toBe(accWithTwoDigits.id);
    expect(match.matchMethod).toBe("weak_pattern_match");
    expect(match.sharedDigits).toBe(2);
    expect(match.confidence).toBeLessThanOrEqual(0.70);

    const decision = evaluateConfidence({
      amount: 300,
      transactionDate: "2026-09-15T13:08:00.000Z",
      direction: "outgoing",
      directionRequiresReview: false,
      senderAccountId: match.accountId,
      senderAccountConfidence: match.confidence,
      senderMatchMethod: match.matchMethod,
      fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
    });

    expect(decision.canAutoCreate).toBe(false);
    expect(decision.status).toBe("needs_review");
  });

  // 5. verified alias auto-confirms
  it("5. verified alias auto-confirms", async () => {
    // Record learned alias
    await DataStore.recordAccountMatchAlias(USER_A, {
      account_id: makeAccountA.id,
      institution: "KBANK",
      raw_masked_pattern: "xxx-x-x7520-x",
      normalized_masked_pattern: "*****7520*",
      source: "manual_confirm",
    });

    const slipBuffer = createSyntheticSlipJpeg({
      amount: 450,
      sender: { bank: "KBANK", accountMasked: "xxx-x-x7520-x", name: "User Fintech" },
      receiver: { bank: "SCB", name: "Merchant Coffee" },
      reference: `ALIAS-AUTOCONFIRM-${Date.now()}`,
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

    const tx = await DataStore.getTransactionById(USER_A, result.transactionId!);
    expect(tx?.from_account_id).toBe(makeAccountA.id);
  });

  // 6. strong bank-consistent positional evidence works safely (>= 3 shared digits)
  it("6. strong bank-consistent positional evidence works safely", async () => {
    const accWithFourDigits = await DataStore.createAccount(USER_A, {
      name: "KBANK 4 Digits",
      type: "bank",
      institution: "KBANK",
      opening_balance: 5000,
      currency: "THB",
      masked_number: "******7520", // 4 visible digits
    });

    const match = matchOwnedAccount(
      { bank: "KBANK", accountMasked: "******7520" },
      [accWithFourDigits]
    );

    expect(match.accountId).toBe(accWithFourDigits.id);
    expect(match.matchMethod).toBe("positional_mask");
    expect(match.sharedDigits).toBe(4);
    expect(match.confidence).toBe(0.95);

    const decision = evaluateConfidence({
      amount: 250,
      transactionDate: "2026-09-15T13:08:00.000Z",
      direction: "outgoing",
      directionRequiresReview: false,
      senderAccountId: match.accountId,
      senderAccountConfidence: match.confidence,
      senderMatchMethod: match.matchMethod,
      fieldConfidence: { amount: 0.99, transactionDate: 0.99 },
    });

    expect(decision.canAutoCreate).toBe(true);
    expect(decision.status).toBe("created");
  });

  // 7. migration/backfill rerun does not inflate confirmed_count
  it("7. migration/backfill rerun does not inflate confirmed_count", async () => {
    // Setup 1 human-corrected transaction
    const slip = await DataStore.createSlip(USER_A, {
      status: "created",
      extracted_json: {
        amount: 324,
        currency: "THB",
        transactionDate: "2026-09-15T13:08:00.000Z",
        sender: { bank: "KBANK", accountMasked: "xxx-x-x7520-x" },
        receiver: { bank: "SCB", name: "Shop" },
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
      review_status: "corrected",
    });

    await DataStore.updateSlip(USER_A, slip.id, {
      linked_transaction_id: tx.id,
    });

    // Run backfill first time
    const res1 = await DataStore.backfillAccountMatchAliases(USER_A);
    expect(res1.created).toBe(1);

    const aliasesAfterFirst = await DataStore.getAccountMatchAliases(USER_A);
    const alias1 = aliasesAfterFirst.find((a) => a.normalized_masked_pattern === "*****7520*");
    expect(alias1).toBeDefined();
    expect(alias1?.confirmed_count).toBe(1);

    // Run backfill second time with identical data
    const res2 = await DataStore.backfillAccountMatchAliases(USER_A);
    expect(res2.created).toBe(1);

    const aliasesAfterSecond = await DataStore.getAccountMatchAliases(USER_A);
    const alias2 = aliasesAfterSecond.find((a) => a.normalized_masked_pattern === "*****7520*");
    // Count MUST NOT be inflated to 2!
    expect(alias2?.confirmed_count).toBe(1);
  });

  // 8. NULL/unknown institution cannot create duplicate alias spam
  it("8. NULL/unknown institution cannot create duplicate alias spam", async () => {
    // Record alias with null institution
    await DataStore.recordAccountMatchAlias(USER_A, {
      account_id: scbAccountA.id,
      institution: null,
      raw_masked_pattern: "1234",
      normalized_masked_pattern: "1234",
      source: "manual_confirm",
    });

    // Record same alias again with undefined institution
    await DataStore.recordAccountMatchAlias(USER_A, {
      account_id: scbAccountA.id,
      institution: undefined,
      raw_masked_pattern: "1234",
      normalized_masked_pattern: "1234",
      source: "manual_confirm",
    });

    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    const matching = aliases.filter((a) => a.normalized_masked_pattern === "1234");
    // Exactly 1 alias row exists, institution normalized to UNKNOWN
    expect(matching).toHaveLength(1);
    expect(matching[0].institution).toBe("UNKNOWN");
    expect(matching[0].confirmed_count).toBe(2);
  });

  // 9. old auto-created confirmed transaction is NOT used for backfill
  it("9. old auto-created confirmed transaction is NOT used for backfill", async () => {
    const slip = await DataStore.createSlip(USER_A, {
      status: "created",
      extracted_json: {
        amount: 800,
        currency: "THB",
        sender: { bank: "KBANK", accountMasked: "xxx-x-x9999-x" },
        receiver: { bank: "SCB", name: "Shop" },
        fieldConfidence: { amount: 0.99 },
      },
    });

    // Old auto-created transaction with review_status='confirmed' (NOT user corrected!)
    const autoTx = await DataStore.createTransaction(USER_A, {
      type: "expense",
      amount: 800,
      currency: "THB",
      transaction_date: "2026-09-15T13:08:00.000Z",
      from_account_id: kbankAccountA.id,
      source: "slip",
      source_slip_id: slip.id,
      review_status: "confirmed", // NOT corrected!
    });

    await DataStore.updateSlip(USER_A, slip.id, {
      linked_transaction_id: autoTx.id,
    });

    const backfillRes = await DataStore.backfillAccountMatchAliases(USER_A);
    expect(backfillRes.created).toBe(0);

    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    const learned = aliases.find((a) => a.normalized_masked_pattern === "*****9999*");
    expect(learned).toBeUndefined();
  });

  // 10. corrected/manual verified transaction IS backfilled
  it("10. corrected/manual verified transaction IS backfilled", async () => {
    const slip = await DataStore.createSlip(USER_A, {
      status: "created",
      extracted_json: {
        amount: 950,
        currency: "THB",
        sender: { bank: "KBANK", accountMasked: "xxx-x-x8888-x" },
        receiver: { bank: "SCB", name: "Shop" },
        fieldConfidence: { amount: 0.99 },
      },
    });

    // Explicit human-edited transaction with review_status='corrected'
    const correctedTx = await DataStore.createTransaction(USER_A, {
      type: "expense",
      amount: 950,
      currency: "THB",
      transaction_date: "2026-09-15T13:08:00.000Z",
      from_account_id: makeAccountA.id,
      source: "slip",
      source_slip_id: slip.id,
      review_status: "corrected", // User manually confirmed/corrected!
    });

    await DataStore.updateSlip(USER_A, slip.id, {
      linked_transaction_id: correctedTx.id,
    });

    const backfillRes = await DataStore.backfillAccountMatchAliases(USER_A);
    expect(backfillRes.created).toBe(1);

    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    const learned = aliases.find((a) => a.normalized_masked_pattern === "*****8888*");
    expect(learned).toBeDefined();
    expect(learned?.account_id).toBe(makeAccountA.id);
  });

  // 11. RPC success + job update failure still returns created
  it("11. RPC success + job update failure still returns created", async () => {
    // Mock updateSlipJob failure after RPC succeeds
    const origUpdateJob = DataStore.updateSlipJob;
    DataStore.updateSlipJob = async (_userId, _jobId, updates) => {
      if (updates.status === "created") {
        throw new Error("Temporary network glitch during job status update");
      }
      return origUpdateJob.call(DataStore, _userId, _jobId, updates);
    };

    try {
      const slipBuffer = createSyntheticSlipJpeg({
        amount: 300,
        sender: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
        receiver: { bank: "KBANK", name: "Cafe" },
        reference: `RPC-OK-JOB-FAIL-${Date.now()}`,
        amountConfidence: 0.99,
        senderAccountConfidence: 0.99,
      });

      const result = await defaultSlipProcessor.processSlip({
        userId: USER_A,
        buffer: slipBuffer,
        source: "ios_shortcut",
      });

      // Crucial requirement: Must NOT downgrade successful transaction to needs_review!
      expect(result.status).toBe("created");
      expect(result.transactionId).toBeDefined();

      // Exactly 1 transaction exists in database
      const txs = await DataStore.getTransactions(USER_A);
      const slipTxs = txs.filter((t) => t.source_slip_id === result.slipId);
      expect(slipTxs).toHaveLength(1);

      // Slip is in created status
      const slip = await DataStore.getSlipById(USER_A, result.slipId);
      expect(slip?.status).toBe("created");
    } finally {
      DataStore.updateSlipJob = origUpdateJob;
    }
  });

  // 12. RPC failure still creates zero transactions
  it("12. RPC failure still creates zero transactions", async () => {
    const origConfirm = DataStore.confirmSlipTransaction;
    DataStore.confirmSlipTransaction = async () => {
      throw new Error("Lock timeout acquiring slip lock");
    };

    try {
      const slipBuffer = createSyntheticSlipJpeg({
        amount: 700,
        sender: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
        receiver: { bank: "KBANK", name: "Store" },
        reference: `RPC-FAIL-${Date.now()}`,
        amountConfidence: 0.99,
        senderAccountConfidence: 0.99,
      });

      const result = await defaultSlipProcessor.processSlip({
        userId: USER_A,
        buffer: slipBuffer,
        source: "ios_shortcut",
      });

      // Must fail closed and create 0 transactions
      expect(result.status).toBe("needs_review");
      expect(result.transactionId).toBeUndefined();

      const txs = await DataStore.getTransactions(USER_A);
      expect(txs).toHaveLength(0);

      const slip = await DataStore.getSlipById(USER_A, result.slipId);
      expect(slip?.status).toBe("needs_review");
    } finally {
      DataStore.confirmSlipTransaction = origConfirm;
    }
  });

  // 13. incoming remains needs_review
  it("13. incoming remains needs_review", async () => {
    const slipBuffer = createSyntheticSlipJpeg({
      amount: 5000,
      sender: { bank: "BBL", name: "Client Corp" },
      receiver: { bank: "SCB", accountMasked: "1234", name: "User Fintech" },
      reference: `INCOMING-TEST-${Date.now()}`,
      amountConfidence: 0.99,
      receiverAccountConfidence: 0.99,
    });

    const result = await defaultSlipProcessor.processSlip({
      userId: USER_A,
      buffer: slipBuffer,
      source: "ios_shortcut",
    });

    // Inflow conservative rule: must require review
    expect(result.status).toBe("needs_review");
    expect(result.transactionId).toBeUndefined();

    const txs = await DataStore.getTransactions(USER_A);
    expect(txs).toHaveLength(0);
  });

  // 14. cross-user isolation unchanged
  it("14. cross-user isolation unchanged", async () => {
    // User A records alias
    await DataStore.recordAccountMatchAlias(USER_A, {
      account_id: makeAccountA.id,
      institution: "KBANK",
      raw_masked_pattern: "xxx-x-x7520-x",
      normalized_masked_pattern: "*****7520*",
      source: "manual_confirm",
    });

    // User B attempts to read aliases
    const userBAliases = await DataStore.getAccountMatchAliases(USER_B);
    expect(userBAliases).toHaveLength(0);

    // User B attempts to match same slip pattern
    const userBAccounts = await DataStore.getAccounts(USER_B);
    const match = matchOwnedAccount(
      { bank: "KBANK", accountMasked: "xxx-x-x7520-x" },
      userBAccounts,
      userBAliases
    );

    // Should not match User A's account or use User A's alias
    expect(match.accountId).not.toBe(makeAccountA.id);
    expect(match.matchMethod).not.toBe("verified_alias");
  });

  // 15. existing 324 THB corrected transaction remains valid backfill candidate
  it("15. existing 324 THB corrected transaction remains valid backfill candidate", async () => {
    // Replicate exact production verification slip and corrected transaction
    const slip324 = await DataStore.createSlip(USER_A, {
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

    const tx324 = await DataStore.createTransaction(USER_A, {
      type: "expense",
      amount: 324,
      currency: "THB",
      transaction_date: "2026-09-15T13:08:00.000Z",
      from_account_id: makeAccountA.id,
      source: "slip",
      source_slip_id: slip324.id,
      review_status: "corrected", // Exact production verified status!
    });

    await DataStore.updateSlip(USER_A, slip324.id, {
      linked_transaction_id: tx324.id,
    });

    const backfillResult = await DataStore.backfillAccountMatchAliases(USER_A);
    expect(backfillResult.created).toBe(1);

    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    const candidateAlias = aliases.find(
      (a) =>
        a.account_id === makeAccountA.id &&
        a.normalized_masked_pattern === "*****7520*"
    );

    expect(candidateAlias).toBeDefined();
    expect(candidateAlias?.institution).toBe("KBANK");
    expect(candidateAlias?.source).toBe("backfill");
    expect(candidateAlias?.confirmed_count).toBe(1);
  });
});

describe("Final Alias Evidence Guard Before Production Migration (8 Required Tests)", () => {
  const USER_A = "11111111-1111-1111-1111-111111111111";
  let kbankAccountA: Account;
  let makeAccountA: Account;
  let scbAccountA: Account;

  beforeEach(async () => {
    DataStore.reset();

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
      masked_number: null,
    });

    scbAccountA = await DataStore.createAccount(USER_A, {
      name: "SCB Main Account",
      type: "bank",
      institution: "SCB",
      opening_balance: 30000,
      currency: "THB",
      masked_number: "1234",
    });
  });

  // 1. all-mask alias "***" is never learned
  it("1. all-mask alias '***' is never learned", async () => {
    await expect(
      DataStore.recordAccountMatchAlias(USER_A, {
        account_id: makeAccountA.id,
        institution: "KBANK",
        raw_masked_pattern: "***",
        normalized_masked_pattern: "***",
      })
    ).rejects.toThrow(/at least 3 visible digits/);

    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    expect(aliases).toHaveLength(0);

    // matchOwnedAccount must not use an all-mask pattern as verified_alias
    const match = matchOwnedAccount(
      { bank: "KBANK", accountMasked: "xxx-xxx-xxx" },
      [makeAccountA, kbankAccountA],
      [
        {
          id: "unsafe-all-mask",
          user_id: USER_A,
          account_id: makeAccountA.id,
          institution: "KBANK",
          raw_masked_pattern: "xxx-xxx-xxx",
          normalized_masked_pattern: "*********",
          source: "manual_confirm",
          confirmed_count: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]
    );
    expect(match.matchMethod).not.toBe("verified_alias");
  });

  // 2. alias with 1 visible digit is never learned
  it("2. alias with 1 visible digit is never learned", async () => {
    await expect(
      DataStore.recordAccountMatchAlias(USER_A, {
        account_id: makeAccountA.id,
        institution: "KBANK",
        raw_masked_pattern: "xx-1-xx",
        normalized_masked_pattern: "**1**",
      })
    ).rejects.toThrow(/at least 3 visible digits/);

    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    expect(aliases).toHaveLength(0);
  });

  // 3. alias with 2 visible digits is never learned
  it("3. alias with 2 visible digits is never learned", async () => {
    await expect(
      DataStore.recordAccountMatchAlias(USER_A, {
        account_id: makeAccountA.id,
        institution: "KBANK",
        raw_masked_pattern: "xx-12-xx",
        normalized_masked_pattern: "**12**",
      })
    ).rejects.toThrow(/at least 3 visible digits/);

    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    expect(aliases).toHaveLength(0);
  });

  // 4. alias with >=3 visible digits can be learned
  it("4. alias with >=3 visible digits can be learned", async () => {
    const alias3 = await DataStore.recordAccountMatchAlias(USER_A, {
      account_id: makeAccountA.id,
      institution: "KBANK",
      raw_masked_pattern: "xxx-123-x",
      normalized_masked_pattern: "***123*",
      source: "manual_confirm",
    });

    expect(alias3).toBeDefined();
    expect(alias3.normalized_masked_pattern).toBe("***123*");
    expect(alias3.confirmed_count).toBe(1);

    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    expect(aliases).toHaveLength(1);
    expect(aliases[0].id).toBe(alias3.id);
  });

  // 5. existing *****7520* alias remains eligible
  it("5. existing *****7520* alias remains eligible", async () => {
    // 4 visible digits -> eligible
    const alias = await DataStore.recordAccountMatchAlias(USER_A, {
      account_id: makeAccountA.id,
      institution: "KBANK",
      raw_masked_pattern: "xxx-x-x7520-x",
      normalized_masked_pattern: "*****7520*",
      source: "manual_confirm",
    });

    const match = matchOwnedAccount(
      { bank: "KBANK", accountMasked: "xxx-x-x7520-x" },
      [makeAccountA, kbankAccountA],
      [alias]
    );

    expect(match.accountId).toBe(makeAccountA.id);
    expect(match.matchMethod).toBe("verified_alias");
    expect(match.confidence).toBe(1.0);
  });

  // 6. two differently formatted raw masks normalizing to the same pattern produce one backfill alias
  it("6. two differently formatted raw masks normalizing to the same pattern produce one backfill alias", async () => {
    // Transaction 1: human-corrected with raw mask 'xxx-x-x7520-x'
    const slip1 = await DataStore.createSlip(USER_A, {
      status: "created",
      extracted_json: {
        amount: 100,
        currency: "THB",
        transactionDate: "2026-09-15T13:08:00.000Z",
        sender: { bank: "KBANK", accountMasked: "xxx-x-x7520-x" },
        receiver: { bank: "SCB", name: "Shop A" },
        fieldConfidence: { amount: 0.99 },
      },
    });

    const tx1 = await DataStore.createTransaction(USER_A, {
      type: "expense",
      amount: 100,
      currency: "THB",
      transaction_date: "2026-09-15T13:08:00.000Z",
      from_account_id: makeAccountA.id,
      source: "slip",
      source_slip_id: slip1.id,
      review_status: "corrected",
    });
    await DataStore.updateSlip(USER_A, slip1.id, { linked_transaction_id: tx1.id });

    // Transaction 2: human-corrected with different raw mask format 'xxxxx7520x'
    const slip2 = await DataStore.createSlip(USER_A, {
      status: "created",
      extracted_json: {
        amount: 200,
        currency: "THB",
        transactionDate: "2026-09-15T14:08:00.000Z",
        sender: { bank: "KBANK", accountMasked: "xxxxx7520x" },
        receiver: { bank: "SCB", name: "Shop B" },
        fieldConfidence: { amount: 0.99 },
      },
    });

    const tx2 = await DataStore.createTransaction(USER_A, {
      type: "expense",
      amount: 200,
      currency: "THB",
      transaction_date: "2026-09-15T14:08:00.000Z",
      from_account_id: makeAccountA.id,
      source: "slip",
      source_slip_id: slip2.id,
      review_status: "corrected",
    });
    await DataStore.updateSlip(USER_A, slip2.id, { linked_transaction_id: tx2.id });

    // Execute backfill
    const result = await DataStore.backfillAccountMatchAliases(USER_A);
    expect(result.created).toBe(1);

    const aliases = await DataStore.getAccountMatchAliases(USER_A);
    // Crucial: exactly ONE alias row for this unique key
    expect(aliases).toHaveLength(1);
    const alias = aliases[0];
    expect(alias.account_id).toBe(makeAccountA.id);
    expect(alias.institution).toBe("KBANK");
    expect(alias.normalized_masked_pattern).toBe("*****7520*");
    // confirmed_count must reflect all 2 verified source transactions!
    expect(alias.confirmed_count).toBe(2);
    // raw_masked_pattern is deterministically chosen
    expect(alias.raw_masked_pattern).toBe("xxx-x-x7520-x");
  });

  // 7. rerunning backfill remains idempotent
  it("7. rerunning backfill remains idempotent", async () => {
    // Create 2 human-corrected transactions
    const slip1 = await DataStore.createSlip(USER_A, {
      status: "created",
      extracted_json: {
        amount: 100,
        sender: { bank: "KBANK", accountMasked: "xxx-x-x7520-x" },
        receiver: { bank: "SCB", name: "Shop A" },
        fieldConfidence: { amount: 0.99 },
      },
    });
    const tx1 = await DataStore.createTransaction(USER_A, {
      type: "expense",
      amount: 100,
      currency: "THB",
      transaction_date: "2026-09-15T13:08:00.000Z",
      from_account_id: makeAccountA.id,
      source: "slip",
      source_slip_id: slip1.id,
      review_status: "corrected",
    });
    await DataStore.updateSlip(USER_A, slip1.id, { linked_transaction_id: tx1.id });

    const slip2 = await DataStore.createSlip(USER_A, {
      status: "created",
      extracted_json: {
        amount: 200,
        sender: { bank: "KBANK", accountMasked: "xxxxx7520x" },
        receiver: { bank: "SCB", name: "Shop B" },
        fieldConfidence: { amount: 0.99 },
      },
    });
    const tx2 = await DataStore.createTransaction(USER_A, {
      type: "expense",
      amount: 200,
      currency: "THB",
      transaction_date: "2026-09-15T14:08:00.000Z",
      from_account_id: makeAccountA.id,
      source: "slip",
      source_slip_id: slip2.id,
      review_status: "corrected",
    });
    await DataStore.updateSlip(USER_A, slip2.id, { linked_transaction_id: tx2.id });

    // Run 1
    await DataStore.backfillAccountMatchAliases(USER_A);
    const aliasesRun1 = await DataStore.getAccountMatchAliases(USER_A);
    expect(aliasesRun1).toHaveLength(1);
    expect(aliasesRun1[0].confirmed_count).toBe(2);

    // Run 2: idempotent rerun
    await DataStore.backfillAccountMatchAliases(USER_A);
    const aliasesRun2 = await DataStore.getAccountMatchAliases(USER_A);
    expect(aliasesRun2).toHaveLength(1);
    expect(aliasesRun2[0].confirmed_count).toBe(2);

    // Run 3: idempotent rerun
    await DataStore.backfillAccountMatchAliases(USER_A);
    const aliasesRun3 = await DataStore.getAccountMatchAliases(USER_A);
    expect(aliasesRun3).toHaveLength(1);
    expect(aliasesRun3[0].confirmed_count).toBe(2);
  });

  // 8. no regression to auto-confirm / cross-bank / incoming safety
  it("8. no regression to auto-confirm / cross-bank / incoming safety", async () => {
    // 8a. High confidence outgoing with verified alias auto-confirms
    await DataStore.recordAccountMatchAlias(USER_A, {
      account_id: makeAccountA.id,
      institution: "KBANK",
      raw_masked_pattern: "xxx-x-x7520-x",
      normalized_masked_pattern: "*****7520*",
      source: "manual_confirm",
    });

    const slipBuffer = createSyntheticSlipJpeg({
      amount: 450,
      sender: { bank: "KBANK", accountMasked: "xxx-x-x7520-x", name: "User Fintech" },
      receiver: { bank: "SCB", accountMasked: "123-456", name: "Merchant Store" },
      reference: `REG-8A-${Date.now()}`,
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

    // 8b. Cross-bank attempt is rejected to needs_review
    const crossBankBuffer = createSyntheticSlipJpeg({
      amount: 450,
      sender: { bank: "BBL", accountMasked: "xxx-x-x5205-x" },
      receiver: { bank: "SCB", name: "Merchant Store" },
      reference: `REG-8B-${Date.now()}`,
      amountConfidence: 0.99,
      senderAccountConfidence: 0.99,
    });
    const crossResult = await defaultSlipProcessor.processSlip({
      userId: USER_A,
      buffer: crossBankBuffer,
      source: "ios_shortcut",
    });
    expect(crossResult.status).toBe("needs_review");

    // 8c. Incoming money always requires review
    const incomingBuffer = createSyntheticSlipJpeg({
      amount: 1500,
      sender: { bank: "BAY", name: "External Client" },
      receiver: { bank: "KBANK", accountMasked: "xxx-x-x5205-x" },
      reference: `REG-8C-${Date.now()}`,
      amountConfidence: 0.99,
      receiverAccountConfidence: 0.99,
    });
    const incomingResult = await defaultSlipProcessor.processSlip({
      userId: USER_A,
      buffer: incomingBuffer,
      source: "ios_shortcut",
    });
    expect(incomingResult.status).toBe("needs_review");
  });
});
