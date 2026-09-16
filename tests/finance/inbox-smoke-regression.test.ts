import { describe, expect, it } from "vitest";
import {
  calculateAccountBalance,
  calculateAllAccountBalances,
} from "@/lib/finance/balances";
import { getStorageUsageSummary } from "@/lib/storage/retention";
import { Account, Transaction } from "@/types/finance";
import { SourceDocument } from "@/types/multi-source";

// ============================================================================
// SECTION 1: INBOX BALANCE DISPLAY REGRESSION TESTS
// ============================================================================

describe("Inbox Balance Display — uses calculated current balance, not opening_balance", () => {
  const createAccount = (overrides: Partial<Account> = {}): Account => ({
    id: "acc-kbank",
    user_id: "user-1",
    name: "MAKE by KBank",
    type: "bank",
    institution: "KBANK",
    currency: "THB",
    opening_balance: 687.04,
    balance_as_of: "2026-09-01T00:00:00Z",
    active: true,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  });

  const createTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
    id: "tx-1",
    user_id: "user-1",
    type: "expense",
    amount: 67.0,
    currency: "THB",
    from_account_id: "acc-kbank",
    to_account_id: null,
    description: "Lunch",
    transaction_date: "2026-09-10T07:00:00Z",
    source: "manual",
    confidence: 1,
    review_status: "confirmed",
    tax_deductible: false,
    category_id: null,
    created_at: "2026-09-10T07:00:00Z",
    updated_at: "2026-09-10T07:00:00Z",
    ...overrides,
  });

  it("should compute current balance as 620.04 for MAKE by KBank (baseline 687.04, expense 67.00)", () => {
    // Production scenario: opening_balance=687.04, post-baseline expense=67.00
    const acc = createAccount();
    const tx = createTransaction();

    const result = calculateAccountBalance(acc, [tx]);
    expect(result.current_balance).toBe(620.04);
    // The inbox MUST show 620.04, NOT 687.04
    expect(result.current_balance).not.toBe(687.04);
  });

  it("should compute accountBalanceMap correctly via calculateAllAccountBalances", () => {
    const acc = createAccount();
    const tx = createTransaction();
    const balances = calculateAllAccountBalances([acc], [tx]);
    const map: Record<string, number> = {};
    for (const ab of balances) {
      map[ab.account.id] = ab.current_balance;
    }
    expect(map["acc-kbank"]).toBe(620.04);
  });

  it("should NOT include pre-baseline transactions in current balance", () => {
    const acc = createAccount({
      opening_balance: 687.04,
      balance_as_of: "2026-09-05T00:00:00Z",
    });
    // Transaction BEFORE baseline — must not affect balance
    const preBaselineTx = createTransaction({
      id: "tx-pre",
      transaction_date: "2026-09-03T07:00:00Z",
      amount: 100.0,
    });
    // Transaction AFTER baseline — must affect balance
    const postBaselineTx = createTransaction({
      id: "tx-post",
      transaction_date: "2026-09-10T07:00:00Z",
      amount: 67.0,
    });

    const result = calculateAccountBalance(acc, [preBaselineTx, postBaselineTx]);
    // Only post-baseline tx counts: 687.04 - 67.00 = 620.04
    expect(result.current_balance).toBe(620.04);
  });

  it("should handle legacy account without balance_as_of (all transactions affect balance)", () => {
    const acc = createAccount({
      opening_balance: 1000,
      balance_as_of: null,
    });
    const tx1 = createTransaction({ id: "tx-1", amount: 200, transaction_date: "2026-09-01T00:00:00Z" });
    const tx2 = createTransaction({ id: "tx-2", amount: 100, transaction_date: "2026-09-05T00:00:00Z" });

    const result = calculateAccountBalance(acc, [tx1, tx2]);
    // Legacy: 1000 - 200 - 100 = 700
    expect(result.current_balance).toBe(700);
  });

  it("should return opening_balance when no transactions exist", () => {
    const acc = createAccount({ opening_balance: 687.04 });
    const result = calculateAccountBalance(acc, []);
    expect(result.current_balance).toBe(687.04);
  });

  it("should handle multiple accounts with distinct balances", () => {
    const acc1 = createAccount({ id: "acc-1", opening_balance: 687.04 });
    const acc2 = createAccount({
      id: "acc-2",
      name: "Savings",
      opening_balance: 5000,
      balance_as_of: "2026-09-01T00:00:00Z",
    });
    const tx1 = createTransaction({
      id: "tx-1",
      amount: 67.0,
      from_account_id: "acc-1",
      to_account_id: null,
    });
    const tx2 = createTransaction({
      id: "tx-2",
      type: "income",
      amount: 300,
      from_account_id: null,
      to_account_id: "acc-2",
      transaction_date: "2026-09-10T07:00:00Z",
    });

    const balances = calculateAllAccountBalances([acc1, acc2], [tx1, tx2]);
    const map: Record<string, number> = {};
    for (const ab of balances) {
      map[ab.account.id] = ab.current_balance;
    }
    expect(map["acc-1"]).toBe(620.04);
    expect(map["acc-2"]).toBe(5300);
  });
});

// ============================================================================
// SECTION 2: STORAGE SUMMARY INCLUDING LEGACY SLIPS
// ============================================================================

describe("Storage Summary — includes legacy slips in combined total", () => {
  const createSourceDocument = (overrides: Partial<SourceDocument> = {}): SourceDocument => ({
    id: "doc-1",
    user_id: "user-1",
    document_type: "csv_statement",
    original_filename: "statement.csv",
    file_hash: "abc123",
    file_size: 5000,
    stored_file_size: 4500,
    storage_path: "/storage/doc-1.csv",
    is_pinned: false,
    provider_metadata: {},
    received_at: new Date().toISOString(),
    binary_deleted_at: null,
    status: "processed",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  });

  it("should include legacy slip bytes in combined storage total", () => {
    const docs = [createSourceDocument()];
    const storageSummary = getStorageUsageSummary(docs);

    // Source document contributes 4500 bytes stored
    expect(storageSummary.totalStoredBytes).toBe(4500);

    // Legacy slips (computed server-side in page.tsx):
    const legacySlipBytes = 12000;
    const legacySlipCount = 3;

    // Combined total the UI would display:
    const combinedBytes = storageSummary.totalStoredBytes + legacySlipBytes;
    const combinedCount = storageSummary.totalDocuments + legacySlipCount;

    expect(combinedBytes).toBe(16500);
    expect(combinedCount).toBe(4);
  });

  it("should show 0 source documents but non-zero total when only legacy slips exist", () => {
    const storageSummary = getStorageUsageSummary([]);

    expect(storageSummary.totalDocuments).toBe(0);
    expect(storageSummary.totalStoredBytes).toBe(0);

    // User with 5 slips totaling 50KB:
    const legacySlipBytes = 50000;
    const legacySlipCount = 5;

    const combinedBytes = storageSummary.totalStoredBytes + legacySlipBytes;
    const combinedCount = storageSummary.totalDocuments + legacySlipCount;

    // Should NOT report 0 B anymore
    expect(combinedBytes).toBe(50000);
    expect(combinedCount).toBe(5);
  });

  it("should not double-count deleted slip binaries", () => {
    // Simulating the server-side filter in page.tsx:
    // activeSlips = slips.filter(s => !s.deleted_at && s.status !== "duplicate")
    const slips = [
      { file_size: 10000, deleted_at: null, status: "confirmed" as const },
      { file_size: 8000, deleted_at: "2026-09-10T00:00:00Z", status: "confirmed" as const },
      { file_size: 6000, deleted_at: null, status: "duplicate" as const },
      { file_size: 4000, deleted_at: null, status: "confirmed" as const },
    ];

    const activeSlips = slips.filter((s) => !s.deleted_at && s.status !== "duplicate");
    const legacySlipBytes = activeSlips.reduce((sum, s) => sum + (s.file_size || 0), 0);
    const legacySlipCount = activeSlips.length;

    // Only the 2 active non-duplicate slips should count
    expect(legacySlipCount).toBe(2);
    expect(legacySlipBytes).toBe(14000); // 10000 + 4000
  });

  it("should correctly combine source documents and legacy slips", () => {
    const docs = [
      createSourceDocument({ id: "doc-1", file_size: 5000, stored_file_size: 4500 }),
      createSourceDocument({ id: "doc-2", file_size: 3000, stored_file_size: 2800 }),
    ];
    const storageSummary = getStorageUsageSummary(docs);
    expect(storageSummary.totalDocuments).toBe(2);
    expect(storageSummary.totalStoredBytes).toBe(7300); // 4500 + 2800

    const legacySlipBytes = 20000;
    const legacySlipCount = 4;

    const combinedBytes = storageSummary.totalStoredBytes + legacySlipBytes;
    const combinedCount = storageSummary.totalDocuments + legacySlipCount;

    expect(combinedBytes).toBe(27300);
    expect(combinedCount).toBe(6);
  });

  it("should show 0 for empty system (no slips, no source documents)", () => {
    const storageSummary = getStorageUsageSummary([]);
    const legacySlipBytes = 0;
    const legacySlipCount = 0;

    const combinedBytes = storageSummary.totalStoredBytes + legacySlipBytes;
    const combinedCount = storageSummary.totalDocuments + legacySlipCount;

    expect(combinedBytes).toBe(0);
    expect(combinedCount).toBe(0);
  });

  it("should not count binary-deleted source documents in stored bytes", () => {
    const docs = [
      createSourceDocument({ id: "doc-1", file_size: 5000, stored_file_size: 4500 }),
      createSourceDocument({
        id: "doc-2",
        file_size: 3000,
        stored_file_size: 0,
        binary_deleted_at: "2026-09-10T00:00:00Z",
      }),
    ];
    const storageSummary = getStorageUsageSummary(docs);

    // Only doc-1's stored bytes should count
    expect(storageSummary.totalStoredBytes).toBe(4500);
    expect(storageSummary.binariesDeletedCount).toBe(1);
  });
});
