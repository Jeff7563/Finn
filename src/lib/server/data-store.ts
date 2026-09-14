import {
  Account,
  Category,
  Merchant,
  Person,
  Transaction,
  TransactionWithRelations,
} from "@/types/finance";
import {
  AccountFormData,
  AccountInput,
  CategoryFormData,
  MerchantFormData,
  PersonFormData,
  TransactionFormData,
  TransactionInput,
} from "../validation/schemas";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import {
  IngestToken,
  Slip,
  SlipIngestionJob,
  SlipCorrection,
} from "@/types/slip";
import {
  generateIngestToken,
  hashToken,
  verifyTokenHash,
  isTokenUsable,
} from "../slip/token";

// Initial default system categories
const DEFAULT_SYSTEM_CATEGORIES: Array<
  Omit<Category, "id" | "created_at" | "updated_at">
> = [
  // Income
  { name: "Salary", type: "income", is_system: true, icon: "briefcase" },
  { name: "Freelance", type: "income", is_system: true, icon: "laptop" },
  { name: "Business", type: "income", is_system: true, icon: "store" },
  { name: "Affiliate", type: "income", is_system: true, icon: "share-2" },
  { name: "Commission", type: "income", is_system: true, icon: "percent" },
  { name: "Refund", type: "income", is_system: true, icon: "rotate-ccw" },
  { name: "Investment Income", type: "income", is_system: true, icon: "trending-up" },
  { name: "Gift", type: "income", is_system: true, icon: "gift" },
  { name: "Loan Received", type: "income", is_system: true, icon: "arrow-down-left" },
  { name: "Other Income", type: "income", is_system: true, icon: "plus-circle" },
  // Expense
  { name: "Food", type: "expense", is_system: true, icon: "utensils" },
  { name: "Transport", type: "expense", is_system: true, icon: "car" },
  { name: "Fuel", type: "expense", is_system: true, icon: "fuel" },
  { name: "Rent", type: "expense", is_system: true, icon: "home" },
  { name: "Utilities", type: "expense", is_system: true, icon: "zap" },
  { name: "Internet", type: "expense", is_system: true, icon: "wifi" },
  { name: "Phone", type: "expense", is_system: true, icon: "smartphone" },
  { name: "Shopping", type: "expense", is_system: true, icon: "shopping-bag" },
  { name: "Entertainment", type: "expense", is_system: true, icon: "film" },
  { name: "Education", type: "expense", is_system: true, icon: "book" },
  { name: "Health", type: "expense", is_system: true, icon: "heart" },
  { name: "Pet", type: "expense", is_system: true, icon: "paw" },
  { name: "Family", type: "expense", is_system: true, icon: "users" },
  { name: "Debt", type: "expense", is_system: true, icon: "credit-card" },
  { name: "Subscription", type: "expense", is_system: true, icon: "repeat" },
  { name: "Investment", type: "expense", is_system: true, icon: "trending-up" },
  { name: "Tax", type: "expense", is_system: true, icon: "file-text" },
  { name: "Donation", type: "expense", is_system: true, icon: "heart-handshake" },
  { name: "Business Expense", type: "expense", is_system: true, icon: "building" },
  { name: "Other", type: "expense", is_system: true, icon: "more-horizontal" },
];

interface LocalDatabaseState {
  accounts: Account[];
  categories: Category[];
  people: Person[];
  merchants: Merchant[];
  transactions: Transaction[];
  ingest_tokens: IngestToken[];
  slips: Slip[];
  slip_ingestion_jobs: SlipIngestionJob[];
  slip_corrections: SlipCorrection[];
}

const LOCAL_STORAGE_FILE = path.resolve(process.cwd(), ".local-db.json");
const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), ".storage", "slips");

// In-memory slip buffer cache for tests
const memorySlipFiles = new Map<string, Buffer>();

function getInitialState(): LocalDatabaseState {
  const categories: Category[] = DEFAULT_SYSTEM_CATEGORIES.map((cat, idx) => ({
    ...cat,
    id: `sys-cat-${idx + 1}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  return {
    accounts: [],
    categories,
    people: [],
    merchants: [],
    transactions: [],
    ingest_tokens: [],
    slips: [],
    slip_ingestion_jobs: [],
    slip_corrections: [],
  };
}

function loadLocalDatabase(): LocalDatabaseState {
  if (process.env.VITEST === "true") {
    if (!dbState) {
      dbState = getInitialState();
    }
    return dbState;
  }
  try {
    if (fs.existsSync(LOCAL_STORAGE_FILE)) {
      const data = fs.readFileSync(LOCAL_STORAGE_FILE, "utf-8");
      const parsed = JSON.parse(data);
      return {
        accounts: parsed.accounts || [],
        categories: parsed.categories || [],
        people: parsed.people || [],
        merchants: parsed.merchants || [],
        transactions: parsed.transactions || [],
        ingest_tokens: parsed.ingest_tokens || [],
        slips: parsed.slips || [],
        slip_ingestion_jobs: parsed.slip_ingestion_jobs || [],
        slip_corrections: parsed.slip_corrections || [],
      };
    }
  } catch {
    // fallback
  }
  const init = getInitialState();
  saveLocalDatabase(init);
  return init;
}

function saveLocalDatabase(state: LocalDatabaseState) {
  if (process.env.VITEST === "true") {
    dbState = state;
    return;
  }
  try {
    fs.writeFileSync(LOCAL_STORAGE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // Ignore in read-only filesystems
  }
}

// Memory cache
let dbState: LocalDatabaseState = getInitialState();
if (process.env.VITEST !== "true") {
  dbState = loadLocalDatabase();
}

function assertUserId(userId: unknown): asserts userId is string {
  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    throw new Error("Authentication required: valid user ID is mandatory");
  }
}

export const DataStore = {
  // ACCOUNTS
  async getAccounts(userId: string): Promise<Account[]> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return dbState.accounts.filter((a) => a.user_id === userId && a.active);
  },

  async getAllAccounts(userId: string): Promise<Account[]> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return dbState.accounts.filter((a) => a.user_id === userId);
  },

  async getAccountById(userId: string, id: string): Promise<Account | null> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return (
      dbState.accounts.find((a) => a.id === id && a.user_id === userId) || null
    );
  },

  async createAccount(
    userId: string,
    data: AccountInput | AccountFormData
  ): Promise<Account> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const now = new Date().toISOString();
    const newAccount: Account = {
      id: crypto.randomUUID(),
      user_id: userId,
      name: data.name,
      institution: data.institution || null,
      type: data.type,
      masked_number: data.masked_number || null,
      opening_balance: Number(data.opening_balance) || 0,
      currency: data.currency || "THB",
      active: data.active ?? true,
      created_at: now,
      updated_at: now,
    };

    dbState.accounts.push(newAccount);
    saveLocalDatabase(dbState);
    return newAccount;
  },

  async updateAccount(
    userId: string,
    id: string,
    data: Partial<AccountFormData>
  ): Promise<Account> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const idx = dbState.accounts.findIndex(
      (a) => a.id === id && a.user_id === userId
    );
    if (idx === -1) {
      throw new Error("Account not found or access denied");
    }

    const current = dbState.accounts[idx];
    const updated: Account = {
      ...current,
      name: data.name ?? current.name,
      institution: data.institution !== undefined ? data.institution : current.institution,
      type: data.type ?? current.type,
      masked_number:
        data.masked_number !== undefined
          ? data.masked_number
          : current.masked_number,
      opening_balance:
        data.opening_balance !== undefined
          ? Number(data.opening_balance)
          : current.opening_balance,
      active: data.active ?? current.active,
      updated_at: new Date().toISOString(),
    };

    dbState.accounts[idx] = updated;
    saveLocalDatabase(dbState);
    return updated;
  },

  async archiveAccount(userId: string, id: string): Promise<void> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const idx = dbState.accounts.findIndex(
      (a) => a.id === id && a.user_id === userId
    );
    if (idx === -1) throw new Error("Account not found or access denied");

    dbState.accounts[idx].active = false;
    dbState.accounts[idx].updated_at = new Date().toISOString();
    saveLocalDatabase(dbState);
  },

  // CATEGORIES
  async getCategories(userId: string): Promise<Category[]> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return dbState.categories.filter(
      (c) => c.is_system || c.user_id === userId
    );
  },

  async createCategory(
    userId: string,
    data: CategoryFormData
  ): Promise<Category> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const now = new Date().toISOString();
    const newCat: Category = {
      id: crypto.randomUUID(),
      user_id: userId,
      name: data.name,
      type: data.type,
      icon: data.icon || null,
      color: data.color || null,
      is_system: false,
      created_at: now,
      updated_at: now,
    };

    dbState.categories.push(newCat);
    saveLocalDatabase(dbState);
    return newCat;
  },

  // PEOPLE
  async getPeople(userId: string): Promise<Person[]> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return dbState.people.filter((p) => p.user_id === userId);
  },

  async getPersonById(userId: string, id: string): Promise<Person | null> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return (
      dbState.people.find((p) => p.id === id && p.user_id === userId) || null
    );
  },

  async createPerson(userId: string, data: PersonFormData): Promise<Person> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const now = new Date().toISOString();
    const newPerson: Person = {
      id: crypto.randomUUID(),
      user_id: userId,
      display_name: data.display_name,
      normalized_name: data.display_name.trim().toLowerCase(),
      aliases: data.aliases || [],
      phone: data.phone || null,
      note: data.note || null,
      created_at: now,
      updated_at: now,
    };

    dbState.people.push(newPerson);
    saveLocalDatabase(dbState);
    return newPerson;
  },

  async updatePerson(
    userId: string,
    id: string,
    data: Partial<PersonFormData>
  ): Promise<Person> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const idx = dbState.people.findIndex(
      (p) => p.id === id && p.user_id === userId
    );
    if (idx === -1) throw new Error("Person not found or access denied");

    const current = dbState.people[idx];
    const updated: Person = {
      ...current,
      display_name: data.display_name ?? current.display_name,
      normalized_name: data.display_name
        ? data.display_name.trim().toLowerCase()
        : current.normalized_name,
      aliases: data.aliases ?? current.aliases,
      phone: data.phone !== undefined ? data.phone : current.phone,
      note: data.note !== undefined ? data.note : current.note,
      updated_at: new Date().toISOString(),
    };

    dbState.people[idx] = updated;
    saveLocalDatabase(dbState);
    return updated;
  },

  // MERCHANTS
  async getMerchants(userId: string): Promise<Merchant[]> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return dbState.merchants.filter((m) => m.user_id === userId);
  },

  async getMerchantById(userId: string, id: string): Promise<Merchant | null> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return (
      dbState.merchants.find((m) => m.id === id && m.user_id === userId) || null
    );
  },

  async createMerchant(
    userId: string,
    data: MerchantFormData
  ): Promise<Merchant> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const now = new Date().toISOString();
    const newMerchant: Merchant = {
      id: crypto.randomUUID(),
      user_id: userId,
      display_name: data.display_name,
      normalized_name: data.display_name.trim().toLowerCase(),
      category_hint: data.category_hint || null,
      aliases: data.aliases || [],
      metadata: {},
      created_at: now,
      updated_at: now,
    };

    dbState.merchants.push(newMerchant);
    saveLocalDatabase(dbState);
    return newMerchant;
  },

  async updateMerchant(
    userId: string,
    id: string,
    data: Partial<MerchantFormData>
  ): Promise<Merchant> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const idx = dbState.merchants.findIndex(
      (m) => m.id === id && m.user_id === userId
    );
    if (idx === -1) throw new Error("Merchant not found or access denied");

    const current = dbState.merchants[idx];
    const updated: Merchant = {
      ...current,
      display_name: data.display_name ?? current.display_name,
      normalized_name: data.display_name
        ? data.display_name.trim().toLowerCase()
        : current.normalized_name,
      category_hint:
        data.category_hint !== undefined
          ? data.category_hint
          : current.category_hint,
      aliases: data.aliases ?? current.aliases,
      updated_at: new Date().toISOString(),
    };

    dbState.merchants[idx] = updated;
    saveLocalDatabase(dbState);
    return updated;
  },

  // TRANSACTIONS
  async getTransactions(userId: string): Promise<TransactionWithRelations[]> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const userTxs = dbState.transactions.filter((t) => t.user_id === userId);

    // Join relations
    return userTxs.map((tx) => {
      const fromAcc = tx.from_account_id
        ? dbState.accounts.find((a) => a.id === tx.from_account_id) || null
        : null;
      const toAcc = tx.to_account_id
        ? dbState.accounts.find((a) => a.id === tx.to_account_id) || null
        : null;
      const person = tx.person_id
        ? dbState.people.find((p) => p.id === tx.person_id) || null
        : null;
      const merchant = tx.merchant_id
        ? dbState.merchants.find((m) => m.id === tx.merchant_id) || null
        : null;
      const category = tx.category_id
        ? dbState.categories.find((c) => c.id === tx.category_id) || null
        : null;

      return {
        ...tx,
        from_account: fromAcc,
        to_account: toAcc,
        person,
        merchant,
        category,
      };
    });
  },

  async getTransactionById(
    userId: string,
    id: string
  ): Promise<TransactionWithRelations | null> {
    const list = await this.getTransactions(userId);
    return list.find((t) => t.id === id) || null;
  },

  async createTransaction(
    userId: string,
    data: TransactionInput | TransactionFormData
  ): Promise<Transaction> {
    dbState = loadLocalDatabase();

    // Validate foreign references belong to authenticated user
    if (data.from_account_id) {
      const exists = dbState.accounts.some(
        (a) => a.id === data.from_account_id && a.user_id === userId
      );
      if (!exists) throw new Error("Invalid source account: access denied or account does not exist");
    }

    if (data.to_account_id) {
      const exists = dbState.accounts.some(
        (a) => a.id === data.to_account_id && a.user_id === userId
      );
      if (!exists) throw new Error("Invalid destination account: access denied or account does not exist");
    }

    if (data.category_id) {
      const exists = dbState.categories.some(
        (c) => c.id === data.category_id && (c.user_id === userId || c.is_system)
      );
      if (!exists) throw new Error("Invalid category: access denied or category does not exist");
    }

    if (data.person_id) {
      const exists = dbState.people.some(
        (p) => p.id === data.person_id && p.user_id === userId
      );
      if (!exists) throw new Error("Invalid counterparty person: access denied or person does not exist");
    }

    if (data.merchant_id) {
      const exists = dbState.merchants.some(
        (m) => m.id === data.merchant_id && m.user_id === userId
      );
      if (!exists) throw new Error("Invalid merchant: access denied or merchant does not exist");
    }

    const numAmount = Number(data.amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      throw new Error("Amount must be a positive finite number");
    }

    if (data.type === "transfer") {
      if (!data.from_account_id || !data.to_account_id) {
        throw new Error("Transfer requires both from and to accounts");
      }
      if (data.from_account_id === data.to_account_id) {
        throw new Error("Source and destination accounts must not be identical");
      }
    }

    const now = new Date().toISOString();
    const newTx: Transaction = {
      id: crypto.randomUUID(),
      user_id: userId,
      type: data.type,
      amount: numAmount,
      currency: data.currency || "THB",
      transaction_date: data.transaction_date,
      description: data.description || null,
      note: data.note || null,
      from_account_id: data.from_account_id || null,
      to_account_id: data.to_account_id || null,
      person_id: data.person_id || null,
      merchant_id: data.merchant_id || null,
      category_id: data.category_id || null,
      payment_method: data.payment_method || null,
      source: data.source || "manual",
      source_slip_id: data.source_slip_id || null,
      reference_number: data.reference_number || null,
      tax_income_type: data.tax_income_type || null,
      tax_deductible: data.tax_deductible ?? false,
      tax_year: data.tax_year || null,
      confidence: data.confidence !== undefined ? data.confidence : 1.0,
      review_status: data.review_status || "confirmed",
      created_at: now,
      updated_at: now,
    };

    dbState.transactions.push(newTx);
    saveLocalDatabase(dbState);
    return newTx;
  },

  async updateTransaction(
    userId: string,
    id: string,
    data: Partial<TransactionFormData>
  ): Promise<Transaction> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const idx = dbState.transactions.findIndex(
      (t) => t.id === id && t.user_id === userId
    );
    if (idx === -1) throw new Error("Transaction not found or access denied");

    const current = dbState.transactions[idx];

    // Check account ownership if modified
    const fromId =
      data.from_account_id !== undefined
        ? data.from_account_id
        : current.from_account_id;
    const toId =
      data.to_account_id !== undefined
        ? data.to_account_id
        : current.to_account_id;
    const personId =
      data.person_id !== undefined ? data.person_id : current.person_id;
    const merchantId =
      data.merchant_id !== undefined ? data.merchant_id : current.merchant_id;
    const categoryId =
      data.category_id !== undefined ? data.category_id : current.category_id;
    const type = data.type || current.type;

    // Validate foreign references belong to authenticated user
    if (fromId) {
      const exists = dbState.accounts.some(
        (a) => a.id === fromId && a.user_id === userId
      );
      if (!exists) throw new Error("Invalid source account: access denied or account does not exist");
    }

    if (toId) {
      const exists = dbState.accounts.some(
        (a) => a.id === toId && a.user_id === userId
      );
      if (!exists) throw new Error("Invalid destination account: access denied or account does not exist");
    }

    if (categoryId) {
      const exists = dbState.categories.some(
        (c) => c.id === categoryId && (c.user_id === userId || c.is_system)
      );
      if (!exists) throw new Error("Invalid category: access denied or category does not exist");
    }

    if (personId) {
      const exists = dbState.people.some(
        (p) => p.id === personId && p.user_id === userId
      );
      if (!exists) throw new Error("Invalid counterparty person: access denied or person does not exist");
    }

    if (merchantId) {
      const exists = dbState.merchants.some(
        (m) => m.id === merchantId && m.user_id === userId
      );
      if (!exists) throw new Error("Invalid merchant: access denied or merchant does not exist");
    }

    let finalAmount = current.amount;
    if (data.amount !== undefined) {
      const numAmount = Number(data.amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) {
        throw new Error("Amount must be a positive finite number");
      }
      finalAmount = numAmount;
    }

    if (type === "transfer") {
      if (!fromId || !toId) {
        throw new Error("Transfer requires both from and to accounts");
      }
      if (fromId === toId) {
        throw new Error("Source and destination accounts must not be identical");
      }
    }

    const updated: Transaction = {
      ...current,
      type,
      amount: finalAmount,
      currency: data.currency || current.currency,
      transaction_date: data.transaction_date || current.transaction_date,
      description:
        data.description !== undefined ? data.description : current.description,
      note: data.note !== undefined ? data.note : current.note,
      from_account_id: fromId,
      to_account_id: toId,
      person_id: personId,
      merchant_id: merchantId,
      category_id: categoryId,
      payment_method:
        data.payment_method !== undefined
          ? data.payment_method
          : current.payment_method,
      tax_income_type:
        data.tax_income_type !== undefined
          ? data.tax_income_type
          : current.tax_income_type,
      tax_deductible:
        data.tax_deductible !== undefined
          ? data.tax_deductible
          : current.tax_deductible,
      updated_at: new Date().toISOString(),
    };

    dbState.transactions[idx] = updated;
    saveLocalDatabase(dbState);
    return updated;
  },

  async deleteTransaction(userId: string, id: string): Promise<void> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const idx = dbState.transactions.findIndex(
      (t) => t.id === id && t.user_id === userId
    );
    if (idx === -1) throw new Error("Transaction not found or access denied");

    dbState.transactions.splice(idx, 1);
    saveLocalDatabase(dbState);
  },

  // INGEST TOKENS
  async getIngestTokens(userId: string): Promise<IngestToken[]> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return dbState.ingest_tokens.filter((t) => t.user_id === userId);
  },

  async createIngestToken(
    userId: string,
    data: { label: string; scope?: string; expires_at?: string | null }
  ): Promise<{ rawToken: string; record: IngestToken }> {
    assertUserId(userId);
    dbState = loadLocalDatabase();

    const { rawToken, tokenHash, tokenPrefix } = generateIngestToken();
    const now = new Date().toISOString();

    const record: IngestToken = {
      id: crypto.randomUUID(),
      user_id: userId,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      label: data.label || "iPhone 11 Pro Max",
      scope: data.scope || "slip:ingest",
      created_at: now,
      last_used_at: null,
      expires_at: data.expires_at || null,
      revoked_at: null,
      metadata: {},
    };

    dbState.ingest_tokens.push(record);
    saveLocalDatabase(dbState);

    return { rawToken, record };
  },

  async verifyAndConsumeIngestToken(rawToken: string): Promise<IngestToken | null> {
    if (!rawToken || typeof rawToken !== "string") return null;
    dbState = loadLocalDatabase();

    const tokenHash = hashToken(rawToken);
    const token = dbState.ingest_tokens.find((t) => t.token_hash === tokenHash);
    if (!token) return null;

    if (!isTokenUsable(token)) {
      return null;
    }

    // Verify constant time
    if (!verifyTokenHash(rawToken, token.token_hash)) {
      return null;
    }

    // Update last_used_at
    token.last_used_at = new Date().toISOString();
    saveLocalDatabase(dbState);

    return token;
  },

  async revokeIngestToken(userId: string, tokenId: string): Promise<void> {
    assertUserId(userId);
    dbState = loadLocalDatabase();

    const idx = dbState.ingest_tokens.findIndex(
      (t) => t.id === tokenId && t.user_id === userId
    );
    if (idx === -1) {
      throw new Error("Token not found or access denied");
    }

    dbState.ingest_tokens[idx].revoked_at = new Date().toISOString();
    saveLocalDatabase(dbState);
  },

  // SLIPS
  async getSlips(userId: string): Promise<Slip[]> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return dbState.slips.filter((s) => s.user_id === userId && !s.deleted_at);
  },

  async getSlipById(userId: string, id: string): Promise<Slip | null> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return (
      dbState.slips.find(
        (s) => s.id === id && s.user_id === userId && !s.deleted_at
      ) || null
    );
  },

  async getSlipByIdUnscoped(id: string): Promise<Slip | null> {
    if (!id) return null;
    dbState = loadLocalDatabase();
    return dbState.slips.find((s) => s.id === id && !s.deleted_at) || null;
  },

  async getSlipByFileHash(userId: string, hash: string): Promise<Slip | null> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return (
      dbState.slips.find(
        (s) =>
          s.user_id === userId &&
          s.file_hash_sha256 === hash &&
          s.status !== "rejected" &&
          s.status !== "duplicate" &&
          !s.deleted_at
      ) || null
    );
  },

  async getPendingReviewSlips(userId: string): Promise<Slip[]> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return dbState.slips
      .filter(
        (s) => s.user_id === userId && s.status === "needs_review" && !s.deleted_at
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async createSlip(userId: string, data: Partial<Slip>): Promise<Slip> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const now = new Date().toISOString();

    const newSlip: Slip = {
      id: data.id || crypto.randomUUID(),
      user_id: userId,
      storage_path: data.storage_path || "",
      file_hash_sha256: data.file_hash_sha256 || "",
      mime_type: data.mime_type || "image/jpeg",
      file_size: data.file_size || 0,
      source: data.source || "web_upload",
      parser_version: data.parser_version || "v1",
      qr_payload: data.qr_payload || null,
      extracted_json: data.extracted_json || null,
      raw_ocr_text: data.raw_ocr_text || null,
      overall_confidence: data.overall_confidence || null,
      status: data.status || "uploaded",
      linked_transaction_id: data.linked_transaction_id || null,
      duplicate_of_slip_id: data.duplicate_of_slip_id || null,
      created_at: now,
      processed_at: data.processed_at || null,
      deleted_at: null,
    };

    dbState.slips.push(newSlip);
    saveLocalDatabase(dbState);
    return newSlip;
  },

  async updateSlip(
    userId: string,
    id: string,
    data: Partial<Slip>
  ): Promise<Slip> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const idx = dbState.slips.findIndex(
      (s) => s.id === id && s.user_id === userId
    );
    if (idx === -1) throw new Error("Slip not found or access denied");

    // Security check on linked_transaction_id
    if (data.linked_transaction_id) {
      const txExists = dbState.transactions.some(
        (t) => t.id === data.linked_transaction_id && t.user_id === userId
      );
      if (!txExists) {
        throw new Error("Security violation: linked transaction must belong to the slip owner");
      }
    }

    const current = dbState.slips[idx];
    const updated: Slip = {
      ...current,
      ...data,
      user_id: userId, // immutable
      id: current.id, // immutable
    };

    dbState.slips[idx] = updated;
    saveLocalDatabase(dbState);
    return updated;
  },

  // SLIP JOBS
  async createSlipJob(
    userId: string,
    data: Partial<SlipIngestionJob>
  ): Promise<SlipIngestionJob> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const now = new Date().toISOString();

    const job: SlipIngestionJob = {
      id: data.id || crypto.randomUUID(),
      user_id: userId,
      slip_id: data.slip_id || "",
      status: data.status || "processing",
      attempt_count: data.attempt_count || 1,
      processor_version: data.processor_version || "v1",
      error_code: data.error_code || null,
      safe_error_message: data.safe_error_message || null,
      started_at: now,
      finished_at: data.finished_at || null,
      created_at: now,
    };

    dbState.slip_ingestion_jobs.push(job);
    saveLocalDatabase(dbState);
    return job;
  },

  async updateSlipJob(
    userId: string,
    id: string,
    data: Partial<SlipIngestionJob>
  ): Promise<SlipIngestionJob> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const idx = dbState.slip_ingestion_jobs.findIndex(
      (j) => j.id === id && j.user_id === userId
    );
    if (idx === -1) throw new Error("Slip job not found or access denied");

    const current = dbState.slip_ingestion_jobs[idx];
    const updated: SlipIngestionJob = {
      ...current,
      ...data,
      user_id: userId,
      id: current.id,
    };

    dbState.slip_ingestion_jobs[idx] = updated;
    saveLocalDatabase(dbState);
    return updated;
  },

  async getSlipJobById(
    userId: string,
    id: string
  ): Promise<SlipIngestionJob | null> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    return (
      dbState.slip_ingestion_jobs.find(
        (j) => j.id === id && j.user_id === userId
      ) || null
    );
  },

  // SLIP CORRECTIONS
  async createSlipCorrection(
    userId: string,
    data: Partial<SlipCorrection>
  ): Promise<SlipCorrection> {
    assertUserId(userId);
    dbState = loadLocalDatabase();
    const now = new Date().toISOString();

    const correction: SlipCorrection = {
      id: crypto.randomUUID(),
      user_id: userId,
      slip_id: data.slip_id || "",
      field_name: data.field_name || "",
      extracted_value: data.extracted_value,
      corrected_value: data.corrected_value,
      created_at: now,
    };

    dbState.slip_corrections.push(correction);
    saveLocalDatabase(dbState);
    return correction;
  },

  // PRIVATE STORAGE
  async saveSlipFile(storagePath: string, buffer: Buffer): Promise<void> {
    memorySlipFiles.set(storagePath, buffer);
    try {
      const fullPath = path.join(LOCAL_STORAGE_DIR, storagePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, buffer);
    } catch {
      // Memory fallback in read-only / test environments
    }
  },

  async getSlipFile(storagePath: string): Promise<Buffer | null> {
    if (memorySlipFiles.has(storagePath)) {
      return memorySlipFiles.get(storagePath)!;
    }
    try {
      const fullPath = path.join(LOCAL_STORAGE_DIR, storagePath);
      if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath);
      }
    } catch {
      // fallback
    }
    return null;
  },

  async createSignedSlipUrl(
    userId: string,
    slipId: string,
    expiresInSeconds = 900
  ): Promise<string> {
    assertUserId(userId);
    const slip = await this.getSlipById(userId, slipId);
    if (!slip) {
      throw new Error("Slip not found or access denied");
    }

    const exp = Date.now() + expiresInSeconds * 1000;
    const secret =
      process.env.SESSION_SECRET || "finn-preview-signature-secret-2026";
    const sig = crypto
      .createHmac("sha256", secret)
      .update(`${slipId}:${exp}`)
      .digest("hex");

    return `/api/slips/${slipId}/preview?exp=${exp}&sig=${sig}`;
  },

  verifySlipPreviewSignature(slipId: string, exp: number, sig: string): boolean {
    if (!slipId || !exp || !sig) return false;
    if (Date.now() > exp) return false;

    const secret =
      process.env.SESSION_SECRET || "finn-preview-signature-secret-2026";
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(`${slipId}:${exp}`)
      .digest("hex");

    try {
      const expectedBuf = Buffer.from(expectedSig, "hex");
      const actualBuf = Buffer.from(sig, "hex");
      if (expectedBuf.length !== actualBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  },

  // Reset database for tests
  reset(initialState?: LocalDatabaseState) {
    dbState = initialState || getInitialState();
    saveLocalDatabase(dbState);
    memorySlipFiles.clear();
  },
};
