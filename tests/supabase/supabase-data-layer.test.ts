import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { SupabaseDataStoreImpl } from "@/lib/server/supabase-data-store";
import { hashToken } from "@/lib/slip/token";
import { calculateTotalActiveBalance, calculateAccountBalance } from "@/lib/finance/balances";
import { calculateMonthSummary } from "@/lib/finance/summaries";
import { isProductionEnvironment, DataStore } from "@/lib/server/data-store";
import { createSlipSignedViewUrl, verifySlipPreviewSignature } from "@/lib/server/private-storage";

interface MockDatabaseBackend {
  tables: Record<string, any[]>;
  storageBuckets: Record<string, { public: boolean; files: Map<string, Buffer> }>;
}

function createNewBackend(): MockDatabaseBackend {
  return {
    tables: {
      accounts: [],
      categories: [
        { id: "cat-sys-1", name: "Salary", type: "income", is_system: true, icon: "briefcase" },
        { id: "cat-sys-2", name: "Food", type: "expense", is_system: true, icon: "utensils" },
      ],
      people: [],
      merchants: [],
      transactions: [],
      ingest_tokens: [],
      slips: [],
      slip_ingestion_jobs: [],
      slip_corrections: [],
    },
    storageBuckets: {
      slips: { public: false, files: new Map() },
    },
  };
}

/**
 * Creates a PostgREST/Supabase client attached to a shared PostgreSQL backend.
 * Implements RLS simulation based on `activeAuthUserId`.
 */
function createSupabaseClientForUser(backend: MockDatabaseBackend, activeAuthUserId?: string) {
  function createQueryBuilder(tableName: string) {
    const filters: Array<(row: any) => boolean> = [];
    let orderFn: ((a: any, b: any) => number) | null = null;
    let pendingUpdatePayload: any = null;
    let pendingInsertRows: any[] | null = null;

    // Simulate PostgreSQL Row Level Security (RLS)
    if (activeAuthUserId) {
      if (tableName === "categories") {
        filters.push((r) => r.is_system === true || r.user_id === activeAuthUserId);
      } else if (tableName !== "profiles") {
        filters.push((r) => r.user_id === activeAuthUserId);
      }
    }

    function executePendingWrites(): { data: any; error: any } | null {
      if (pendingInsertRows) {
        const inserted = pendingInsertRows.map((r) => {
          const row = {
            id: r.id || crypto.randomUUID(),
            created_at: r.created_at || new Date().toISOString(),
            updated_at: r.updated_at || new Date().toISOString(),
            deleted_at: null,
            revoked_at: null,
            ...r,
          };
          backend.tables[tableName].push(row);
          return row;
        });
        return { data: inserted, error: null };
      }

      if (pendingUpdatePayload) {
        const matched = backend.tables[tableName].filter((r) =>
          filters.every((fn) => fn(r))
        );
        if (matched.length === 0) {
          return { data: null, error: new Error("Row not found or RLS access denied") };
        }
        for (const row of matched) {
          Object.assign(row, pendingUpdatePayload, { updated_at: new Date().toISOString() });
        }
        return { data: matched[0], error: null };
      }

      return null;
    }

    const builder: any = {
      select(columns = "*") {
        return builder;
      },
      eq(column: string, value: any) {
        filters.push((r) => r[column] === value);
        return builder;
      },
      neq(column: string, value: any) {
        filters.push((r) => r[column] !== value);
        return builder;
      },
      is(column: string, value: any) {
        if (value === null) {
          filters.push((r) => r[column] === null || r[column] === undefined);
        } else {
          filters.push((r) => r[column] === value);
        }
        return builder;
      },
      or(clause: string) {
        const parts = clause.split(",");
        filters.push((r) => {
          return parts.some((part) => {
            const [col, op, val] = part.split(".");
            if (op === "eq") {
              if (val === "true") return r[col] === true;
              if (val === "false") return r[col] === false;
              return r[col] === val;
            }
            return false;
          });
        });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        const asc = opts?.ascending ?? true;
        orderFn = (a, b) => {
          if (a[column] < b[column]) return asc ? -1 : 1;
          if (a[column] > b[column]) return asc ? 1 : -1;
          return 0;
        };
        return builder;
      },
      insert(payload: any) {
        pendingInsertRows = Array.isArray(payload) ? payload : [payload];
        return builder;
      },
      update(payload: any) {
        pendingUpdatePayload = payload;
        return builder;
      },
      delete() {
        const initialCount = backend.tables[tableName].length;
        backend.tables[tableName] = backend.tables[tableName].filter(
          (r) => !filters.every((fn) => fn(r))
        );
        const deletedCount = initialCount - backend.tables[tableName].length;
        const err = deletedCount === 0 ? new Error("Row not found or access denied") : null;

        return {
          then: (onfulfilled?: any, onrejected?: any) =>
            Promise.resolve({ data: null, error: err, count: deletedCount }).then(
              onfulfilled,
              onrejected
            ),
        };
      },
      async single() {
        const writeResult = executePendingWrites();
        if (writeResult) {
          if (writeResult.error) return writeResult;
          const val = Array.isArray(writeResult.data) ? writeResult.data[0] : writeResult.data;
          return { data: val, error: null };
        }

        let matched = backend.tables[tableName].filter((r) =>
          filters.every((fn) => fn(r))
        );
        if (orderFn) matched.sort(orderFn);
        if (matched.length === 0) {
          return { data: null, error: new Error("Row not found or access denied") };
        }
        return { data: matched[0], error: null };
      },
      async maybeSingle() {
        const writeResult = executePendingWrites();
        if (writeResult) {
          if (writeResult.error) return writeResult;
          const val = Array.isArray(writeResult.data) ? writeResult.data[0] : writeResult.data;
          return { data: val, error: null };
        }

        let matched = backend.tables[tableName].filter((r) =>
          filters.every((fn) => fn(r))
        );
        if (orderFn) matched.sort(orderFn);
        return { data: matched.length > 0 ? matched[0] : null, error: null };
      },
      then(onfulfilled?: any, onrejected?: any) {
        const writeResult = executePendingWrites();
        if (writeResult) {
          return Promise.resolve(writeResult).then(onfulfilled, onrejected);
        }

        let matched = backend.tables[tableName].filter((r) =>
          filters.every((fn) => fn(r))
        );
        if (orderFn) matched.sort(orderFn);
        return Promise.resolve({ data: matched, error: null }).then(
          onfulfilled,
          onrejected
        );
      },
    };

    return builder;
  }

  const storageBuilder = {
    from(bucketId: string) {
      const bucket = backend.storageBuckets[bucketId];
      if (!bucket) throw new Error(`Storage bucket '${bucketId}' does not exist`);

      return {
        async upload(path: string, buffer: Buffer) {
          // Check RLS storage folder policy: path must start with auth user id
          if (activeAuthUserId) {
            const folderOwner = path.split("/")[0];
            if (folderOwner !== activeAuthUserId) {
              return { data: null, error: new Error("RLS Storage Policy Violation: Cross-user path") };
            }
          }
          bucket.files.set(path, buffer);
          return { data: { path }, error: null };
        },
        async download(path: string) {
          if (activeAuthUserId) {
            const folderOwner = path.split("/")[0];
            if (folderOwner !== activeAuthUserId) {
              return { data: null, error: new Error("RLS Storage Policy Violation: Cross-user path") };
            }
          }
          const file = bucket.files.get(path);
          if (!file) {
            return { data: null, error: new Error("Object not found in bucket") };
          }
          return {
            data: {
              arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
            },
            error: null,
          };
        },
        async createSignedUrl(path: string, expiresIn: number) {
          const token = crypto.randomUUID();
          return {
            data: { signedUrl: `https://supabase.co/storage/v1/object/sign/${bucketId}/${path}?token=${token}` },
            error: null,
          };
        },
      };
    },
  };

  return {
    from: createQueryBuilder,
    storage: storageBuilder,
    auth: {
      async getUser() {
        return activeAuthUserId
          ? { data: { user: { id: activeAuthUserId, email: `${activeAuthUserId}@finn.local` } }, error: null }
          : { data: { user: null }, error: new Error("Not authenticated") };
      },
    },
  };
}

describe("Supabase Production Data Layer & Security Verification", () => {
  const USER_A = "user-alice-prod-1";
  const USER_B = "user-bob-prod-2";

  let backend: MockDatabaseBackend;
  let clientA: any;
  let clientB: any;
  let storeA: SupabaseDataStoreImpl;
  let storeB: SupabaseDataStoreImpl;

  beforeEach(() => {
    // Fresh PostgreSQL + Storage backend
    backend = createNewBackend();

    // Authenticated Supabase clients with PostgreSQL RLS active
    clientA = createSupabaseClientForUser(backend, USER_A);
    clientB = createSupabaseClientForUser(backend, USER_B);

    // Instances of SupabaseDataStore connected to clientA and clientB
    storeA = new SupabaseDataStoreImpl(clientA);
    storeB = new SupabaseDataStoreImpl(clientB);
  });

  // 1. Data Survives Separate Requests
  it("REQ-1: Data survives separate requests across distinct store instances", async () => {
    // Request 1: User A creates an account and transaction
    const createdAcc = await storeA.createAccount(USER_A, {
      name: "Primary Savings",
      type: "bank",
      institution: "KBANK",
      opening_balance: 50000,
    });

    const createdTx = await storeA.createTransaction(USER_A, {
      type: "income",
      amount: 12000,
      to_account_id: createdAcc.id,
      transaction_date: new Date().toISOString(),
      description: "Freelance Project",
      source: "manual",
    });

    // Request 2: A completely separate request instance fetches accounts and transactions
    const separateClient = createSupabaseClientForUser(backend, USER_A);
    const separateStoreInstance = new SupabaseDataStoreImpl(separateClient);
    const fetchedAccounts = await separateStoreInstance.getAccounts(USER_A);
    const fetchedTxs = await separateStoreInstance.getTransactions(USER_A);

    expect(fetchedAccounts.length).toBe(1);
    expect(fetchedAccounts[0].id).toBe(createdAcc.id);
    expect(fetchedAccounts[0].name).toBe("Primary Savings");
    expect(fetchedAccounts[0].opening_balance).toBe(50000);

    expect(fetchedTxs.length).toBe(1);
    expect(fetchedTxs[0].id).toBe(createdTx.id);
    expect(fetchedTxs[0].amount).toBe(12000);
    expect(fetchedTxs[0].to_account?.name).toBe("Primary Savings");
  });

  // 2. User A Cannot Access User B Data (Strict Row Level Security)
  it("REQ-2: Strict cross-user isolation: User A cannot read, update, or delete User B data", async () => {
    // Bob creates accounts, people, merchants, transactions, ingest tokens, and slips
    const bobAcc = await storeB.createAccount(USER_B, {
      name: "Bob Secret Account",
      type: "bank",
      opening_balance: 100000,
    });

    const bobTx = await storeB.createTransaction(USER_B, {
      type: "expense",
      amount: 4500,
      from_account_id: bobAcc.id,
      transaction_date: new Date().toISOString(),
      description: "Confidential Bob Expense",
      source: "manual",
    });

    const bobSlip = await storeB.createSlip(USER_B, {
      storage_path: `${USER_B}/2026/09/bob_receipt.jpg`,
      file_hash_sha256: "hash_bob_receipt_sha256",
      status: "needs_review",
    });

    const { record: bobToken } = await storeB.createIngestToken(USER_B, {
      label: "Bob Private Phone",
    });

    // Alice attempts to list accounts -> Bob's account must NOT appear
    const aliceAccounts = await storeA.getAccounts(USER_A);
    expect(aliceAccounts.some((a) => a.id === bobAcc.id)).toBe(false);

    // Alice attempts to read Bob's account directly
    const directAccount = await storeA.getAccountById(USER_A, bobAcc.id);
    expect(directAccount).toBeNull();

    // Alice attempts to list transactions -> Bob's transaction must NOT appear
    const aliceTxs = await storeA.getTransactions(USER_A);
    expect(aliceTxs.some((t) => t.id === bobTx.id)).toBe(false);

    // Alice attempts to update Bob's transaction
    await expect(
      storeA.updateTransaction(USER_A, bobTx.id, { description: "Hijacked by Alice" })
    ).rejects.toThrow(/not found or access denied/i);

    // Alice attempts to delete Bob's transaction
    await expect(storeA.deleteTransaction(USER_A, bobTx.id)).rejects.toThrow();

    // Alice attempts to read Bob's slip
    const directSlip = await storeA.getSlipById(USER_A, bobSlip.id);
    expect(directSlip).toBeNull();

    // Alice attempts to revoke Bob's ingest token
    await expect(storeA.revokeIngestToken(USER_A, bobToken.id)).rejects.toThrow(
      /not found or access denied/i
    );

    // Alice attempts to hijack Bob's account in a transaction
    await expect(
      storeA.createTransaction(USER_A, {
        type: "expense",
        amount: 200,
        from_account_id: bobAcc.id, // Bob's account
        transaction_date: new Date().toISOString(),
      })
    ).rejects.toThrow(/invalid source account/i);
  });

  // 3. Ingest Token Records Stored Hashed in Supabase
  it("REQ-3: Ingest token records are stored hashed in Supabase and raw token is never persisted", async () => {
    const { rawToken, record } = await storeA.createIngestToken(USER_A, {
      label: "iPhone 16 Pro Shortcut",
    });

    // 1. Raw token format check
    expect(rawToken).toContain("finn_ingest_");

    // 2. Database record only stores hash
    expect(record.token_hash).toBe(hashToken(rawToken));
    expect(record.token_hash).not.toContain("finn_ingest_");
    expect(record.token_hash).not.toBe(rawToken);

    // 3. Raw token verification via constant-time hash
    // Ingest token verification operates via server admin client (unscoped auth)
    const serverClient = createSupabaseClientForUser(backend);
    const serverStore = new SupabaseDataStoreImpl(serverClient);

    const verified = await serverStore.verifyAndConsumeIngestToken(rawToken);
    expect(verified).not.toBeNull();
    expect(verified?.user_id).toBe(USER_A);
    expect(verified?.last_used_at).toBeTruthy();

    // 4. Revocation check
    await storeA.revokeIngestToken(USER_A, record.id);
    const postRevocation = await serverStore.verifyAndConsumeIngestToken(rawToken);
    expect(postRevocation).toBeNull();
  });

  // 4. Slip Files are Private
  it("REQ-4: Slip binary files are strictly private in Supabase Storage", async () => {
    const slipBuffer = Buffer.from("fake-slip-image-binary-payload-jpeg-magic");
    const storagePath = `${USER_A}/2026/09/secure_slip.jpg`;

    // Upload to private storage
    await storeA.saveSlipFile(storagePath, slipBuffer);

    // Owner (Alice) can retrieve the file
    const retrieved = await storeA.getSlipFile(storagePath);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.toString()).toBe(slipBuffer.toString());

    // Non-owner (Bob) is rejected when attempting to download Alice's slip file
    const bobAttempt = await storeB.getSlipFile(storagePath);
    expect(bobAttempt).toBeNull();

    // Bob cannot upload a file into Alice's owner prefix
    await expect(
      storeB.saveSlipFile(`${USER_A}/2026/09/malicious.jpg`, slipBuffer)
    ).rejects.toThrow(/storage.*violation/i);
  });

  // 5. Signed Preview URL Works
  it("REQ-5: Signed preview URLs verify HMAC signatures and reject tampering", async () => {
    const slip = await storeA.createSlip(USER_A, {
      storage_path: `${USER_A}/2026/09/preview_test.jpg`,
      file_hash_sha256: "preview_test_sha256",
      status: "needs_review",
    });

    // Generate signed preview URL (clamped to 300s max)
    const { url: signedUrl } = await createSlipSignedViewUrl(USER_A, slip.id, 120, storeA);
    const url = new URL(`http://localhost${signedUrl}`);
    const exp = parseInt(url.searchParams.get("exp") || "0", 10);
    const sig = url.searchParams.get("sig") || "";

    expect(sig).toBeTruthy();
    expect(verifySlipPreviewSignature(slip.id, exp, sig)).toBe(true);

    // Tampered signature is rejected
    expect(verifySlipPreviewSignature(slip.id, exp, "forged_hex_signature")).toBe(false);

    // Tampered slip ID is rejected
    expect(verifySlipPreviewSignature("different-slip-uuid", exp, sig)).toBe(false);

    // Expired timestamp is rejected
    const expiredExp = Date.now() - 5000;
    expect(verifySlipPreviewSignature(slip.id, expiredExp, sig)).toBe(false);
  });

  // 6. Finance Calculations Remain Unchanged
  it("REQ-6: Finance calculations remain unchanged and accurate with Supabase models", async () => {
    const bankAcc = await storeA.createAccount(USER_A, {
      name: "Business Bank Account",
      type: "bank",
      opening_balance: 10000,
    });

    const cashAcc = await storeA.createAccount(USER_A, {
      name: "Cash Wallet",
      type: "cash",
      opening_balance: 2000,
    });

    // 1. Income +15,000 to bank
    await storeA.createTransaction(USER_A, {
      type: "income",
      amount: 15000,
      to_account_id: bankAcc.id,
      transaction_date: "2026-09-05T12:00:00Z",
    });

    // 2. Expense -3,500 from bank
    await storeA.createTransaction(USER_A, {
      type: "expense",
      amount: 3500,
      from_account_id: bankAcc.id,
      transaction_date: "2026-09-06T12:00:00Z",
    });

    // 3. Transfer 1,500 bank -> cash
    await storeA.createTransaction(USER_A, {
      type: "transfer",
      amount: 1500,
      from_account_id: bankAcc.id,
      to_account_id: cashAcc.id,
      transaction_date: "2026-09-07T12:00:00Z",
    });

    const [accounts, txs] = await Promise.all([
      storeA.getAccounts(USER_A),
      storeA.getTransactions(USER_A),
    ]);

    // Account balances
    const bankBal = calculateAccountBalance(accounts.find((a) => a.id === bankAcc.id)!, txs);
    const cashBal = calculateAccountBalance(accounts.find((a) => a.id === cashAcc.id)!, txs);

    // 10,000 + 15,000 - 3,500 - 1,500 = 20,000
    expect(bankBal.current_balance).toBe(20000);

    // 2,000 + 1,500 = 3,500
    expect(cashBal.current_balance).toBe(3500);

    // Total active balance = 20,000 + 3,500 = 23,500
    const totalBal = calculateTotalActiveBalance(accounts, txs);
    expect(totalBal).toBe(23500);

    // Month summary: transfers excluded
    const summary = calculateMonthSummary(txs, new Date("2026-09-10"));
    expect(summary.income_total).toBe(15000);
    expect(summary.expense_total).toBe(3500);
    expect(summary.net_cash_flow).toBe(11500);
  });

  // 7. Duplicate Protection Still Works
  it("REQ-7: Exact SHA-256 duplicate file detection prevents duplicate records", async () => {
    const fileHash = "deterministic_sha256_hash_test_value_12345";

    // First slip upload
    const slip1 = await storeA.createSlip(USER_A, {
      file_hash_sha256: fileHash,
      storage_path: `${USER_A}/2026/09/first.jpg`,
      status: "created",
    });

    // Query duplicate by file hash
    const dupCheck = await storeA.getSlipByFileHash(USER_A, fileHash);
    expect(dupCheck).not.toBeNull();
    expect(dupCheck?.id).toBe(slip1.id);

    // Cross-user duplicate lookup does NOT expose Alice's slip to Bob
    const bobDupCheck = await storeB.getSlipByFileHash(USER_B, fileHash);
    expect(bobDupCheck).toBeNull();
  });

  // 8. Production Fails Closed
  it("REQ-8: Production environment strictly enforces Supabase and fails closed on reset", () => {
    const envObj = process.env as Record<string, string | undefined>;
    const origEnv = envObj["NODE_ENV"];
    const origVitest = envObj["VITEST"];
    const origPlaywright = envObj["PLAYWRIGHT_TEST"];
    const origMode = envObj["DATASTORE_MODE"];
    try {
      delete envObj["VITEST"];
      delete envObj["PLAYWRIGHT_TEST"];
      delete envObj["DATASTORE_MODE"];
      envObj["NODE_ENV"] = "production";
      expect(isProductionEnvironment()).toBe(true);

      // Reset is forbidden in production
      expect(() => DataStore.reset()).toThrow(/disabled in production/i);
    } finally {
      envObj["NODE_ENV"] = origEnv;
      if (origVitest !== undefined) envObj["VITEST"] = origVitest;
      if (origPlaywright !== undefined) envObj["PLAYWRIGHT_TEST"] = origPlaywright;
      if (origMode !== undefined) envObj["DATASTORE_MODE"] = origMode;
    }
  });
});
