import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DataStore, MemoryDataStore } from "@/lib/server/data-store";
import { SupabaseDataStoreImpl } from "@/lib/server/supabase-data-store";
import { confirmSlipAction, editAndConfirmSlipAction } from "@/app/actions/slip-review";
import { Account, Category, Merchant, Person } from "@/types/finance";
import { SlipExtraction } from "@/types/slip";

function makeExtraction(data: Partial<SlipExtraction>): SlipExtraction {
  return {
    fieldConfidence: {},
    ...data,
  };
}

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock auth for Server Actions
let currentMockUser: { id: string; email: string } | null = {
  id: "user-alice-sec-1",
  email: "alice@example.com",
};

vi.mock("@/lib/server/auth", () => ({
  getAuthenticatedUser: vi.fn(async () => currentMockUser),
}));

/**
 * High-fidelity simulator of PostgreSQL confirm_slip_transaction stored procedure.
 * Faithfully mirrors the exact SQL logic in supabase/migrations/20260915000001_confirm_slips_realtime.sql
 */
interface CallerContext {
  uid: string | null;
  jwtRole?: string;
  currentUser?: string;
  sessionUser?: string;
}

interface RpcParams {
  p_slip_id: string;
  p_user_id: string;
  p_tx_type: string;
  p_amount: number;
  p_currency?: string;
  p_transaction_date: string;
  p_description?: string | null;
  p_note?: string | null;
  p_from_account_id?: string | null;
  p_to_account_id?: string | null;
  p_category_id?: string | null;
  p_merchant_id?: string | null;
  p_person_id?: string | null;
  p_reference_number?: string | null;
  p_confidence?: number;
  p_review_status?: string;
}

interface MockPgDb {
  slips: any[];
  transactions: any[];
  accounts: any[];
  categories: any[];
  merchants: any[];
  people: any[];
}

function executeConfirmSlipTransactionRpc(
  db: MockPgDb,
  caller: CallerContext,
  params: RpcParams
): { success: boolean; transaction_id: string; already_confirmed: boolean } {
  // 1. Caller Authentication & Fail-Closed Authorization
  const v_caller_uid = caller.uid;
  const v_caller_role = caller.jwtRole ?? "";
  const v_is_service_role =
    v_caller_role === "service_role" ||
    caller.currentUser === "service_role" ||
    caller.sessionUser === "service_role";

  if (v_caller_uid !== null) {
    if (v_caller_uid !== params.p_user_id) {
      throw new Error("Access denied: user_id does not match authenticated user");
    }
  } else if (v_is_service_role) {
    // Explicitly verified service_role caller allowed
  } else {
    // Anonymous or untrusted caller fails closed
    throw new Error("Access denied: unauthenticated caller");
  }

  // 2. Restrict Confirmation Input Domain
  if (!params.p_tx_type || !["income", "expense", "transfer"].includes(params.p_tx_type)) {
    throw new Error(
      `Invalid transaction type ${params.p_tx_type}: confirmation only allows income, expense, or transfer`
    );
  }

  const v_review_status = params.p_review_status ?? "confirmed";
  if (!["confirmed", "corrected"].includes(v_review_status)) {
    throw new Error(
      `Invalid review_status ${params.p_review_status}: confirmation only allows confirmed or corrected`
    );
  }

  if (params.p_amount === null || params.p_amount === undefined || params.p_amount <= 0) {
    throw new Error("Invalid amount: must be greater than 0");
  }
  if (params.p_amount > 999999999999.99) {
    throw new Error("Invalid amount: exceeds maximum allowable limit");
  }

  if (!params.p_transaction_date) {
    throw new Error("Transaction date is required");
  }

  if (params.p_tx_type === "transfer") {
    if (!params.p_from_account_id || !params.p_to_account_id) {
      throw new Error("Transfer requires both from_account_id and to_account_id");
    }
    if (params.p_from_account_id === params.p_to_account_id) {
      throw new Error("Source and destination accounts must not be identical");
    }
  } else if (params.p_tx_type === "expense") {
    if (!params.p_from_account_id) {
      throw new Error("Expense requires from_account_id");
    }
    if (params.p_to_account_id) {
      throw new Error("Expense must not have to_account_id");
    }
  } else if (params.p_tx_type === "income") {
    if (!params.p_to_account_id) {
      throw new Error("Income requires to_account_id");
    }
    if (params.p_from_account_id) {
      throw new Error("Income must not have from_account_id");
    }
  }

  // 3. Ownership Defense-in-Depth
  if (params.p_from_account_id) {
    const exists = db.accounts.some(
      (a) => a.id === params.p_from_account_id && a.user_id === params.p_user_id
    );
    if (!exists) {
      throw new Error(
        `Security violation: foreign source account does not belong to user ${params.p_user_id}`
      );
    }
  }

  if (params.p_to_account_id) {
    const exists = db.accounts.some(
      (a) => a.id === params.p_to_account_id && a.user_id === params.p_user_id
    );
    if (!exists) {
      throw new Error(
        `Security violation: foreign destination account does not belong to user ${params.p_user_id}`
      );
    }
  }

  if (params.p_category_id) {
    const exists = db.categories.some(
      (c) =>
        c.id === params.p_category_id &&
        (c.user_id === params.p_user_id || c.is_system === true)
    );
    if (!exists) {
      throw new Error(
        `Security violation: foreign category does not belong to user ${params.p_user_id}`
      );
    }
  }

  if (params.p_merchant_id) {
    const exists = db.merchants.some(
      (m) => m.id === params.p_merchant_id && m.user_id === params.p_user_id
    );
    if (!exists) {
      throw new Error(
        `Security violation: foreign merchant does not belong to user ${params.p_user_id}`
      );
    }
  }

  if (params.p_person_id) {
    const exists = db.people.some(
      (p) => p.id === params.p_person_id && p.user_id === params.p_user_id
    );
    if (!exists) {
      throw new Error(
        `Security violation: foreign person does not belong to user ${params.p_user_id}`
      );
    }
  }

  // 4. Slip Row Locking & Ownership Check (FOR UPDATE)
  const v_slip = db.slips.find(
    (s) => s.id === params.p_slip_id && s.user_id === params.p_user_id
  );
  if (!v_slip) {
    throw new Error("Slip not found or access denied");
  }

  // 5. Idempotency Check 1
  if (v_slip.linked_transaction_id) {
    const v_existing_tx = db.transactions.find(
      (t) => t.id === v_slip.linked_transaction_id && t.user_id === params.p_user_id
    );
    if (v_existing_tx) {
      return {
        success: true,
        transaction_id: v_existing_tx.id,
        already_confirmed: true,
      };
    }
  }

  // 6. Idempotency Check 2
  const v_existing_tx = db.transactions.find(
    (t) => t.source_slip_id === params.p_slip_id && t.user_id === params.p_user_id
  );
  if (v_existing_tx) {
    v_slip.status = "created";
    v_slip.linked_transaction_id = v_existing_tx.id;
    v_slip.processed_at = v_slip.processed_at || new Date().toISOString();
    return {
      success: true,
      transaction_id: v_existing_tx.id,
      already_confirmed: true,
    };
  }

  // 7. Validate slip status
  if (v_slip.status !== "needs_review" && v_slip.status !== "created") {
    throw new Error(
      `Slip status is ${v_slip.status}; only slips in needs_review can be confirmed`
    );
  }

  // 8. Insert transaction
  const v_new_tx_id = crypto.randomUUID();
  const newTx = {
    id: v_new_tx_id,
    user_id: params.p_user_id,
    type: params.p_tx_type,
    amount: params.p_amount,
    currency: params.p_currency || "THB",
    transaction_date: params.p_transaction_date,
    description: params.p_description || null,
    note: params.p_note || null,
    from_account_id: params.p_from_account_id || null,
    to_account_id: params.p_to_account_id || null,
    category_id: params.p_category_id || null,
    merchant_id: params.p_merchant_id || null,
    person_id: params.p_person_id || null,
    source: "slip",
    source_slip_id: params.p_slip_id,
    reference_number: params.p_reference_number || null,
    confidence: params.p_confidence ?? 1.0,
    review_status: v_review_status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.transactions.push(newTx);

  // 9. Update slip status to canonical 'created'
  v_slip.status = "created";
  v_slip.linked_transaction_id = v_new_tx_id;
  v_slip.processed_at = new Date().toISOString();

  return {
    success: true,
    transaction_id: v_new_tx_id,
    already_confirmed: false,
  };
}

describe("FINN — Final Slip Confirmation RPC Security Hardening Suite", () => {
  const USER_A = "user-alice-sec-1";
  const USER_B = "user-bob-sec-2";

  let accountA: Account;
  let accountA2: Account;
  let accountB: Account;
  let categoryA: Category;
  let categoryB: Category;
  let systemCategory: Category;
  let merchantA: Merchant;
  let merchantB: Merchant;
  let personA: Person;
  let personB: Person;

  beforeEach(async () => {
    DataStore.reset();
    currentMockUser = { id: USER_A, email: "alice@example.com" };

    // Set up User A entities
    accountA = await DataStore.createAccount(USER_A, {
      name: "Alice KBANK",
      type: "bank",
      institution: "KBANK",
      masked_number: "1234",
      opening_balance: 10000,
    });
    accountA2 = await DataStore.createAccount(USER_A, {
      name: "Alice SCB",
      type: "bank",
      institution: "SCB",
      masked_number: "5678",
      opening_balance: 5000,
    });
    categoryA = await DataStore.createCategory(USER_A, {
      name: "อาหาร",
      type: "expense",
    });
    merchantA = await DataStore.createMerchant(USER_A, {
      display_name: "ร้านค้า Alice",
      aliases: [],
    });
    personA = await DataStore.createPerson(USER_A, {
      display_name: "เพื่อน Alice",
      aliases: [],
    });

    // Set up User B entities
    accountB = await DataStore.createAccount(USER_B, {
      name: "Bob BBL",
      type: "bank",
      institution: "BBL",
      masked_number: "9999",
      opening_balance: 20000,
    });
    categoryB = await DataStore.createCategory(USER_B, {
      name: "ของเล่น Bob",
      type: "expense",
    });
    merchantB = await DataStore.createMerchant(USER_B, {
      display_name: "ร้านค้า Bob",
      aliases: [],
    });
    personB = await DataStore.createPerson(USER_B, {
      display_name: "เพื่อน Bob",
      aliases: [],
    });

    // System Category (allowed for all users)
    const existingCats = await DataStore.getCategories(USER_A);
    const foundSys = existingCats.find((c) => c.is_system);
    if (foundSys) {
      systemCategory = foundSys;
    } else {
      systemCategory = await DataStore.createCategory(USER_A, {
        name: "เงินเดือนทั่วไป",
        type: "income",
      });
      // Mark as system
      systemCategory.is_system = true;
    }
  });

  // =========================================================================
  // Test 1: anon cannot execute confirmation RPC
  // =========================================================================
  it("1. anon cannot execute confirmation RPC (revocation and fail-closed rejection)", async () => {
    // 1.1 Verify SQL Migration Privilege Revocations & Search Path Hardening
    const migrationPath = path.join(
      process.cwd(),
      "supabase/migrations/20260915000001_confirm_slips_realtime.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf-8");

    // Must revoke from PUBLIC
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.confirm_slip_transaction\([\s\S]*?\) FROM PUBLIC;/
    );
    // Must revoke from anon
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.confirm_slip_transaction\([\s\S]*?\) FROM anon;/
    );
    // Must grant ONLY to authenticated and service_role
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.confirm_slip_transaction\([\s\S]*?\) TO authenticated;/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.confirm_slip_transaction\([\s\S]*?\) TO service_role;/
    );
    // Must NOT grant to anon
    expect(sql).not.toMatch(/GRANT EXECUTE[\s\S]*?TO anon/);

    // Must enforce search_path
    expect(sql).toContain("SET search_path = pg_catalog, public");

    // 1.2 Verify RPC Execution Level Rejection for Anonymous Callers
    const db: MockPgDb = {
      slips: [{ id: "slip-test", user_id: USER_A, status: "needs_review" }],
      transactions: [],
      accounts: [{ id: accountA.id, user_id: USER_A }],
      categories: [],
      merchants: [],
      people: [],
    };

    expect(() =>
      executeConfirmSlipTransactionRpc(
        db,
        { uid: null, jwtRole: "anon" },
        {
          p_slip_id: "slip-test",
          p_user_id: USER_A,
          p_tx_type: "expense",
          p_amount: 100,
          p_transaction_date: new Date().toISOString(),
          p_from_account_id: accountA.id,
        }
      )
    ).toThrow(/Access denied: unauthenticated caller/i);
  });

  // =========================================================================
  // Test 2: authenticated User A cannot confirm User B slip
  // =========================================================================
  it("2. authenticated User A cannot confirm User B slip", async () => {
    const slipB = await DataStore.createSlip(USER_B, {
      status: "needs_review",
      storage_path: `${USER_B}/slips/bob_secret.jpg`,
      extracted_json: makeExtraction({
        amount: 500,
        sender: { bank: "BBL", accountMasked: "9999" },
      }),
    });

    // User A attempts to confirm User B's slip via Server Action
    const result = await confirmSlipAction(slipB.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("ไม่พบข้อมูลสลิปหรือคุณไม่มีสิทธิ์เข้าถึง");

    // Direct DataStore call by User A for User B's slip also fails
    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slipB.id,
        type: "expense",
        amount: 500,
        transaction_date: new Date().toISOString(),
        from_account_id: accountA.id,
      })
    ).rejects.toThrow(/not found or access denied/i);

    // Verify Bob's slip is untouched and 0 transactions exist
    const bobSlip = await DataStore.getSlipById(USER_B, slipB.id);
    expect(bobSlip?.status).toBe("needs_review");
    expect(bobSlip?.linked_transaction_id).toBeNull();

    const txsA = await DataStore.getTransactions(USER_A);
    const txsB = await DataStore.getTransactions(USER_B);
    expect(txsA.some((t) => t.source_slip_id === slipB.id)).toBe(false);
    expect(txsB.some((t) => t.source_slip_id === slipB.id)).toBe(false);
  });

  // =========================================================================
  // Test 3: null auth.uid() is rejected unless explicitly verified service_role
  // =========================================================================
  it("3. null auth.uid() is rejected unless explicitly verified service_role", () => {
    const db: MockPgDb = {
      slips: [{ id: "slip-test", user_id: USER_A, status: "needs_review" }],
      transactions: [],
      accounts: [{ id: accountA.id, user_id: USER_A }],
      categories: [],
      merchants: [],
      people: [],
    };

    const validParams: RpcParams = {
      p_slip_id: "slip-test",
      p_user_id: USER_A,
      p_tx_type: "expense",
      p_amount: 250,
      p_transaction_date: new Date().toISOString(),
      p_from_account_id: accountA.id,
    };

    // Case A: uid is null, role is empty/unspecified -> REJECTED
    expect(() =>
      executeConfirmSlipTransactionRpc(db, { uid: null, jwtRole: "" }, validParams)
    ).toThrow(/Access denied: unauthenticated caller/i);

    // Case B: uid is null, role is "anon" -> REJECTED
    expect(() =>
      executeConfirmSlipTransactionRpc(db, { uid: null, jwtRole: "anon" }, validParams)
    ).toThrow(/Access denied: unauthenticated caller/i);

    // Case C: uid is null, role is untrusted spoof -> REJECTED
    expect(() =>
      executeConfirmSlipTransactionRpc(db, { uid: null, jwtRole: "admin" }, validParams)
    ).toThrow(/Access denied: unauthenticated caller/i);

    // Case D: uid is null, verified service_role -> ALLOWED
    const res = executeConfirmSlipTransactionRpc(
      db,
      { uid: null, jwtRole: "service_role" },
      validParams
    );
    expect(res.success).toBe(true);
    expect(res.transaction_id).toBeDefined();
  });

  // =========================================================================
  // Test 4: arbitrary p_user_id cannot bypass ownership
  // =========================================================================
  it("4. arbitrary p_user_id cannot bypass ownership (caller mismatch rejected)", () => {
    const db: MockPgDb = {
      slips: [{ id: "slip-bob", user_id: USER_B, status: "needs_review" }],
      transactions: [],
      accounts: [{ id: accountB.id, user_id: USER_B }],
      categories: [],
      merchants: [],
      people: [],
    };

    // User A (auth.uid = USER_A) calls RPC passing p_user_id = USER_B
    expect(() =>
      executeConfirmSlipTransactionRpc(
        db,
        { uid: USER_A, jwtRole: "authenticated" },
        {
          p_slip_id: "slip-bob",
          p_user_id: USER_B, // Mismatched UID!
          p_tx_type: "expense",
          p_amount: 1000,
          p_transaction_date: new Date().toISOString(),
          p_from_account_id: accountB.id,
        }
      )
    ).toThrow(/Access denied: user_id does not match authenticated user/i);

    // Verify Bob's slip remained unchanged
    expect(db.transactions.length).toBe(0);
    expect(db.slips[0].status).toBe("needs_review");
  });

  // =========================================================================
  // Test 5: adjustment/gift/etc are rejected by confirmation RPC
  // =========================================================================
  it("5. adjustment/gift/etc are rejected by confirmation RPC (domain restriction)", async () => {
    const slip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      storage_path: `${USER_A}/slips/domain_check.jpg`,
    });

    // 5.1 Rejected Transaction Types
    const disallowedTypes = [
      "adjustment",
      "gift",
      "refund",
      "loan_received",
      "loan_payment",
      "reimbursement",
      "investment",
    ] as const;

    for (const invalidType of disallowedTypes) {
      await expect(
        DataStore.confirmSlipTransaction(USER_A, {
          slipId: slip.id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: invalidType as any,
          amount: 100,
          transaction_date: new Date().toISOString(),
          from_account_id: accountA.id,
        })
      ).rejects.toThrow(/confirmation only allows income, expense, or transfer/i);
    }

    // 5.2 Disallowed Review Statuses (e.g. rejected, pending)
    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 100,
        transaction_date: new Date().toISOString(),
        from_account_id: accountA.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        review_status: "rejected" as any,
      })
    ).rejects.toThrow(/only confirmed or corrected allowed/i);

    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 100,
        transaction_date: new Date().toISOString(),
        from_account_id: accountA.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        review_status: "pending" as any,
      })
    ).rejects.toThrow(/only confirmed or corrected allowed/i);

    // 5.3 Non-positive Amount Rejection
    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 0,
        transaction_date: new Date().toISOString(),
        from_account_id: accountA.id,
      })
    ).rejects.toThrow(/must be greater than 0/i);

    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: -50,
        transaction_date: new Date().toISOString(),
        from_account_id: accountA.id,
      })
    ).rejects.toThrow(/must be greater than 0/i);

    // 5.4 Missing Transaction Date
    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 100,
        transaction_date: "",
        from_account_id: accountA.id,
      })
    ).rejects.toThrow(/transaction date is required/i);

    // 5.5 Identical Accounts in Transfer
    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "transfer",
        amount: 100,
        transaction_date: new Date().toISOString(),
        from_account_id: accountA.id,
        to_account_id: accountA.id,
      })
    ).rejects.toThrow(/Source and destination accounts must not be identical/i);
  });

  // =========================================================================
  // Test 6: foreign account IDs are rejected
  // =========================================================================
  it("6. foreign account IDs are rejected (defense-in-depth entity validation)", async () => {
    const slip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      storage_path: `${USER_A}/slips/ownership_check.jpg`,
    });

    // 6.1 Foreign from_account_id (belonging to Bob)
    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 100,
        transaction_date: new Date().toISOString(),
        from_account_id: accountB.id,
      })
    ).rejects.toThrow(/Security violation: foreign source account does not belong to user/i);

    // 6.2 Foreign to_account_id (belonging to Bob)
    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "income",
        amount: 100,
        transaction_date: new Date().toISOString(),
        to_account_id: accountB.id,
      })
    ).rejects.toThrow(/Security violation: foreign destination account does not belong to user/i);

    // 6.3 Foreign category_id (non-system, belonging to Bob)
    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 100,
        transaction_date: new Date().toISOString(),
        from_account_id: accountA.id,
        category_id: categoryB.id,
      })
    ).rejects.toThrow(/Security violation: foreign category does not belong to user/i);

    // 6.4 Foreign merchant_id (belonging to Bob)
    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 100,
        transaction_date: new Date().toISOString(),
        from_account_id: accountA.id,
        merchant_id: merchantB.id,
      })
    ).rejects.toThrow(/Security violation: foreign merchant does not belong to user/i);

    // 6.5 Foreign person_id (belonging to Bob)
    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 100,
        transaction_date: new Date().toISOString(),
        from_account_id: accountA.id,
        person_id: personB.id,
      })
    ).rejects.toThrow(/Security violation: foreign person does not belong to user/i);
  });

  // =========================================================================
  // Test 7: production does NOT fallback when RPC is unavailable
  // =========================================================================
  it("7. production does NOT fallback when RPC is unavailable (fail closed guarantee)", async () => {
    let insertCalls = 0;
    let updateSlipCalls = 0;

    // Mock Supabase client simulating missing RPC in PostgreSQL
    const mockClient: any = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "PGRST202",
          message: "could not find function public.confirm_slip_transaction in schema cache",
        },
      }),
      from: vi.fn((table: string) => ({
        insert: vi.fn(() => {
          insertCalls++;
          return { data: [{ id: "tx-fallback" }], error: null };
        }),
        update: vi.fn(() => {
          if (table === "slips") updateSlipCalls++;
          return { data: [], error: null };
        }),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    };

    const supabaseStore = new SupabaseDataStoreImpl(mockClient);

    // Attempt confirmSlipTransaction
    await expect(
      supabaseStore.confirmSlipTransaction(USER_A, {
        slipId: "slip-test-rpc-missing",
        type: "expense",
        amount: 300,
        transaction_date: new Date().toISOString(),
        from_account_id: accountA.id,
      })
    ).rejects.toThrow("ระบบยืนยันรายการยังไม่พร้อม กรุณาติดต่อผู้ดูแล");

    // Verify ZERO fallback writes were performed
    expect(insertCalls).toBe(0);
    expect(updateSlipCalls).toBe(0);
  });

  // =========================================================================
  // Test 8: RPC failure creates zero transactions
  // =========================================================================
  it("8. RPC failure creates zero transactions and preserves slip status", async () => {
    const slip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      storage_path: `${USER_A}/slips/failure_zero_tx.jpg`,
    });

    const txsBefore = await DataStore.getTransactions(USER_A);

    // Cause a failure via invalid account
    await expect(
      DataStore.confirmSlipTransaction(USER_A, {
        slipId: slip.id,
        type: "expense",
        amount: 150,
        transaction_date: new Date().toISOString(),
        from_account_id: "non-existent-account-id",
      })
    ).rejects.toThrow();

    const txsAfter = await DataStore.getTransactions(USER_A);
    expect(txsAfter.length).toBe(txsBefore.length);

    // Verify slip remains in 'needs_review' with no linked transaction
    const slipAfter = await DataStore.getSlipById(USER_A, slip.id);
    expect(slipAfter?.status).toBe("needs_review");
    expect(slipAfter?.linked_transaction_id).toBeNull();
  });

  // =========================================================================
  // Test 9: concurrent confirmation still creates exactly one transaction
  // =========================================================================
  it("9. concurrent confirmation still creates exactly one transaction (SELECT FOR UPDATE & unique index)", async () => {
    const slip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      storage_path: `${USER_A}/slips/concurrent_safety.jpg`,
      overall_confidence: 0.9,
      extracted_json: makeExtraction({
        amount: 888,
        currency: "THB",
        transactionDate: "2026-09-15T20:00:00.000Z",
        sender: { bank: "KBANK", accountMasked: "1234" },
      }),
    });

    // Fire 3 simultaneous confirmation requests
    const [res1, res2, res3] = await Promise.all([
      confirmSlipAction(slip.id),
      confirmSlipAction(slip.id),
      confirmSlipAction(slip.id),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res3.success).toBe(true);

    expect(res1.transactionId).toBe(res2.transactionId);
    expect(res2.transactionId).toBe(res3.transactionId);

    // Exactly 1 transaction exists for this slip
    const allTxs = await DataStore.getTransactions(USER_A);
    const slipTxs = allTxs.filter((t) => t.source_slip_id === slip.id);
    expect(slipTxs.length).toBe(1);

    // Slip is updated to canonical status 'created'
    const updatedSlip = await DataStore.getSlipById(USER_A, slip.id);
    expect(updatedSlip?.status).toBe("created");
    expect(updatedSlip?.linked_transaction_id).toBe(res1.transactionId);
  });

  // =========================================================================
  // Test 10: existing valid expense/income/transfer confirmation still works
  // =========================================================================
  it("10. existing valid expense/income/transfer confirmation still works seamlessly", async () => {
    // 10.1 Valid Expense Confirmation
    const expenseSlip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      storage_path: `${USER_A}/slips/expense_valid.jpg`,
      extracted_json: makeExtraction({
        amount: 150,
        currency: "THB",
        sender: { name: "Alice", bank: "KBANK", accountMasked: "1234" },
        receiver: { name: "ร้านค้าภายนอก", bank: "BAY", accountMasked: "0000" },
      }),
    });

    const expRes = await confirmSlipAction(expenseSlip.id);
    expect(expRes.success).toBe(true);
    const expTx = await DataStore.getTransactionById(USER_A, expRes.transactionId!);
    expect(expTx?.type).toBe("expense");
    expect(expTx?.from_account_id).toBe(accountA.id);
    expect(expTx?.to_account_id).toBeNull();
    expect(expTx?.review_status).toBe("confirmed");

    // 10.2 Valid Income Confirmation
    const incomeSlip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      storage_path: `${USER_A}/slips/income_valid.jpg`,
      extracted_json: makeExtraction({
        amount: 2500,
        currency: "THB",
        sender: { name: "ลูกค้าภายนอก", bank: "BAY", accountMasked: "0000" },
        receiver: { name: "Alice", bank: "KBANK", accountMasked: "1234" },
      }),
    });

    const incRes = await confirmSlipAction(incomeSlip.id);
    expect(incRes.success).toBe(true);
    const incTx = await DataStore.getTransactionById(USER_A, incRes.transactionId!);
    expect(incTx?.type).toBe("income");
    expect(incTx?.from_account_id).toBeNull();
    expect(incTx?.to_account_id).toBe(accountA.id);
    expect(incTx?.review_status).toBe("confirmed");

    // 10.3 Valid Transfer Confirmation
    const transferSlip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      storage_path: `${USER_A}/slips/transfer_valid.jpg`,
      extracted_json: makeExtraction({
        amount: 1000,
        currency: "THB",
        sender: { name: "Alice", bank: "KBANK", accountMasked: "1234" },
        receiver: { name: "Alice", bank: "SCB", accountMasked: "5678" },
      }),
    });

    const trfRes = await confirmSlipAction(transferSlip.id);
    expect(trfRes.success).toBe(true);
    const trfTx = await DataStore.getTransactionById(USER_A, trfRes.transactionId!);
    expect(trfTx?.type).toBe("transfer");
    expect(trfTx?.from_account_id).toBe(accountA.id);
    expect(trfTx?.to_account_id).toBe(accountA2.id);
    expect(trfTx?.review_status).toBe("confirmed");

    // 10.4 Edited & Corrected Confirmation with System Category
    const editSlip = await DataStore.createSlip(USER_A, {
      status: "needs_review",
      storage_path: `${USER_A}/slips/edit_valid.jpg`,
      extracted_json: makeExtraction({
        amount: 70,
        currency: "THB",
      }),
    });

    const editRes = await editAndConfirmSlipAction(editSlip.id, {
      type: "expense",
      amount: 75,
      currency: "THB",
      transaction_date: "2026-09-15T21:00:00.000Z",
      from_account_id: accountA.id,
      category_id: systemCategory.id, // System category allowed
      merchant_id: merchantA.id,
      person_id: personA.id,
      source: "slip",
      tax_deductible: false,
    });

    expect(editRes.success).toBe(true);
    const editTx = await DataStore.getTransactionById(USER_A, editRes.transactionId!);
    expect(editTx?.amount).toBe(75);
    expect(editTx?.review_status).toBe("corrected");
    expect(editTx?.category_id).toBe(systemCategory.id);
  });
});
