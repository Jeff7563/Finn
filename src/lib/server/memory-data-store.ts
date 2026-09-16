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
import crypto from "crypto";

import {
  IngestToken,
  Slip,
  SlipIngestionJob,
  SlipCorrection,
  AccountMatchAlias,
} from "@/types/slip";
import { normalizeBankName } from "../slip/bank-normalization";
import {
  countVisibleDigits,
  hasSufficientVisibleDigits,
  normalizeMaskedPattern,
} from "../slip/mask-pattern";
import {
  PreloadedRelations,
  TransactionsPageData,
  ConfirmSlipTransactionInput,
  ConfirmSlipTransactionResult,
} from "./data-store-interface";
import {
  generateIngestToken,
  hashToken,
  verifyTokenHash,
  isTokenUsable,
} from "../slip/token";
import { IDataStore } from "./data-store-interface";

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

export interface MemoryDatabaseState {
  accounts: Account[];
  categories: Category[];
  people: Person[];
  merchants: Merchant[];
  transactions: Transaction[];
  ingest_tokens: IngestToken[];
  slips: Slip[];
  slip_ingestion_jobs: SlipIngestionJob[];
  slip_corrections: SlipCorrection[];
  account_match_aliases: AccountMatchAlias[];
}

function getInitialState(): MemoryDatabaseState {
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
    account_match_aliases: [],
  };
}

interface GlobalMemoryStore {
  __finn_memory_db__?: MemoryDatabaseState;
  __finn_memory_slips__?: Map<string, Buffer>;
}

const globalForMemory = globalThis as unknown as GlobalMemoryStore;

function getDbState(): MemoryDatabaseState {
  if (!globalForMemory.__finn_memory_db__) {
    globalForMemory.__finn_memory_db__ = getInitialState();
  }
  return globalForMemory.__finn_memory_db__;
}

function getMemorySlipFiles(): Map<string, Buffer> {
  if (!globalForMemory.__finn_memory_slips__) {
    globalForMemory.__finn_memory_slips__ = new Map<string, Buffer>();
  }
  return globalForMemory.__finn_memory_slips__;
}

const dbState = new Proxy({} as MemoryDatabaseState, {
  get(_target, prop: keyof MemoryDatabaseState) {
    return getDbState()[prop];
  },
  set(_target, prop: keyof MemoryDatabaseState, value) {
    (getDbState() as unknown as Record<string, unknown>)[prop as string] = value;
    return true;
  },
});

const memorySlipFiles = new Proxy(new Map<string, Buffer>(), {
  get(_target, prop: keyof Map<string, Buffer>) {
    const map = getMemorySlipFiles();
    const val = (map as unknown as Record<string, unknown>)[prop as string];
    if (typeof val === "function") {
      return (val as (...args: unknown[]) => unknown).bind(map);
    }
    return val;
  },
});

function assertUserId(userId: unknown): asserts userId is string {
  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    throw new Error("Authentication required: valid user ID is mandatory");
  }
}

export const MemoryDataStore: IDataStore = {
  // ACCOUNTS
  async getAccounts(userId: string): Promise<Account[]> {
    assertUserId(userId);
    return dbState.accounts.filter((a) => a.user_id === userId && a.active);
  },

  async getAllAccounts(userId: string): Promise<Account[]> {
    assertUserId(userId);
    return dbState.accounts.filter((a) => a.user_id === userId);
  },

  async getAccountById(userId: string, id: string): Promise<Account | null> {
    assertUserId(userId);
    return (
      dbState.accounts.find((a) => a.id === id && a.user_id === userId) || null
    );
  },

  async createAccount(
    userId: string,
    data: AccountInput | AccountFormData
  ): Promise<Account> {
    assertUserId(userId);
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
      balance_as_of: data.balance_as_of || null,
      created_at: now,
      updated_at: now,
    };

    dbState.accounts.push(newAccount);
    return newAccount;
  },

  async updateAccount(
    userId: string,
    id: string,
    data: Partial<AccountFormData>
  ): Promise<Account> {
    assertUserId(userId);
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
      balance_as_of:
        data.balance_as_of !== undefined
          ? (data.balance_as_of || null)
          : current.balance_as_of,
      updated_at: new Date().toISOString(),
    };

    dbState.accounts[idx] = updated;
    return updated;
  },

  async archiveAccount(userId: string, id: string): Promise<void> {
    assertUserId(userId);
    const idx = dbState.accounts.findIndex(
      (a) => a.id === id && a.user_id === userId
    );
    if (idx === -1) throw new Error("Account not found or access denied");

    dbState.accounts[idx].active = false;
    dbState.accounts[idx].updated_at = new Date().toISOString();
  },

  // CATEGORIES
  async getCategories(userId: string): Promise<Category[]> {
    assertUserId(userId);
    return dbState.categories.filter(
      (c) => c.is_system || c.user_id === userId
    );
  },

  async createCategory(
    userId: string,
    data: CategoryFormData
  ): Promise<Category> {
    assertUserId(userId);
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
    return newCat;
  },

  // PEOPLE
  async getPeople(userId: string): Promise<Person[]> {
    assertUserId(userId);
    return dbState.people.filter((p) => p.user_id === userId);
  },

  async getPersonById(userId: string, id: string): Promise<Person | null> {
    assertUserId(userId);
    return (
      dbState.people.find((p) => p.id === id && p.user_id === userId) || null
    );
  },

  async createPerson(userId: string, data: PersonFormData): Promise<Person> {
    assertUserId(userId);
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
    return newPerson;
  },

  async updatePerson(
    userId: string,
    id: string,
    data: Partial<PersonFormData>
  ): Promise<Person> {
    assertUserId(userId);
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
    return updated;
  },

  // MERCHANTS
  async getMerchants(userId: string): Promise<Merchant[]> {
    assertUserId(userId);
    return dbState.merchants.filter((m) => m.user_id === userId);
  },

  async getMerchantById(userId: string, id: string): Promise<Merchant | null> {
    assertUserId(userId);
    return (
      dbState.merchants.find((m) => m.id === id && m.user_id === userId) || null
    );
  },

  async createMerchant(
    userId: string,
    data: MerchantFormData
  ): Promise<Merchant> {
    assertUserId(userId);
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
    return newMerchant;
  },

  async updateMerchant(
    userId: string,
    id: string,
    data: Partial<MerchantFormData>
  ): Promise<Merchant> {
    assertUserId(userId);
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
    return updated;
  },

  // TRANSACTIONS
  async getTransactions(
    userId: string,
    preloadedRelations?: PreloadedRelations
  ): Promise<TransactionWithRelations[]> {
    assertUserId(userId);
    const userTxs = dbState.transactions.filter((t) => t.user_id === userId);

    const accounts = preloadedRelations?.accounts ?? dbState.accounts;
    const people = preloadedRelations?.people ?? dbState.people;
    const merchants = preloadedRelations?.merchants ?? dbState.merchants;
    const categories = preloadedRelations?.categories ?? dbState.categories;

    return userTxs.map((tx) => {
      const fromAcc = tx.from_account_id
        ? accounts.find((a) => a.id === tx.from_account_id) || null
        : null;
      const toAcc = tx.to_account_id
        ? accounts.find((a) => a.id === tx.to_account_id) || null
        : null;
      const person = tx.person_id
        ? people.find((p) => p.id === tx.person_id) || null
        : null;
      const merchant = tx.merchant_id
        ? merchants.find((m) => m.id === tx.merchant_id) || null
        : null;
      const category = tx.category_id
        ? categories.find((c) => c.id === tx.category_id) || null
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

  async getTransactionsPageData(userId: string): Promise<TransactionsPageData> {
    assertUserId(userId);
    const [accounts, categories, people, merchants] = await Promise.all([
      this.getAccounts(userId),
      this.getCategories(userId),
      this.getPeople(userId),
      this.getMerchants(userId),
    ]);
    const transactions = await this.getTransactions(userId, {
      accounts,
      categories,
      people,
      merchants,
    });
    return {
      transactions,
      accounts,
      categories,
      people,
      merchants,
    };
  },

  async getTransactionById(
    userId: string,
    id: string,
    preloadedRelations?: PreloadedRelations
  ): Promise<TransactionWithRelations | null> {
    const list = await this.getTransactions(userId, preloadedRelations);
    return list.find((t) => t.id === id) || null;
  },

  async createTransaction(
    userId: string,
    data: TransactionInput | TransactionFormData
  ): Promise<Transaction> {
    assertUserId(userId);

    // Idempotency: if transaction for this source_slip_id was already created, return it
    if (data.source_slip_id) {
      const existing = dbState.transactions.find(
        (t) => t.source_slip_id === data.source_slip_id && t.user_id === userId
      );
      if (existing) {
        return existing;
      }
    }

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
    return newTx;
  },

  async updateTransaction(
    userId: string,
    id: string,
    data: Partial<TransactionFormData>
  ): Promise<Transaction> {
    assertUserId(userId);
    const idx = dbState.transactions.findIndex(
      (t) => t.id === id && t.user_id === userId
    );
    if (idx === -1) throw new Error("Transaction not found or access denied");

    const current = dbState.transactions[idx];

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
    return updated;
  },

  async deleteTransaction(userId: string, id: string): Promise<void> {
    assertUserId(userId);
    const idx = dbState.transactions.findIndex(
      (t) => t.id === id && t.user_id === userId
    );
    if (idx === -1) throw new Error("Transaction not found or access denied");

    dbState.transactions.splice(idx, 1);
  },

  // INGEST TOKENS
  async getIngestTokens(userId: string): Promise<IngestToken[]> {
    assertUserId(userId);
    return dbState.ingest_tokens.filter((t) => t.user_id === userId);
  },

  async createIngestToken(
    userId: string,
    data: { label: string; scope?: string; expires_at?: string | null }
  ): Promise<{ rawToken: string; record: IngestToken }> {
    assertUserId(userId);

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
    return { rawToken, record };
  },

  async verifyAndConsumeIngestToken(rawToken: string): Promise<IngestToken | null> {
    if (!rawToken || typeof rawToken !== "string") return null;

    const tokenHash = hashToken(rawToken);
    const token = dbState.ingest_tokens.find((t) => t.token_hash === tokenHash);
    if (!token) return null;

    if (!isTokenUsable(token)) {
      return null;
    }

    if (!verifyTokenHash(rawToken, token.token_hash)) {
      return null;
    }

    token.last_used_at = new Date().toISOString();
    return token;
  },

  async revokeIngestToken(userId: string, tokenId: string): Promise<void> {
    assertUserId(userId);

    const idx = dbState.ingest_tokens.findIndex(
      (t) => t.id === tokenId && t.user_id === userId
    );
    if (idx === -1) {
      throw new Error("Token not found or access denied");
    }

    dbState.ingest_tokens[idx].revoked_at = new Date().toISOString();
  },

  // SLIPS
  async getSlips(userId: string): Promise<Slip[]> {
    assertUserId(userId);
    return dbState.slips.filter((s) => s.user_id === userId && !s.deleted_at);
  },

  async getSlipById(userId: string, id: string): Promise<Slip | null> {
    assertUserId(userId);
    return (
      dbState.slips.find(
        (s) => s.id === id && s.user_id === userId && !s.deleted_at
      ) || null
    );
  },

  async getSlipByIdUnscoped(id: string): Promise<Slip | null> {
    if (!id) return null;
    return dbState.slips.find((s) => s.id === id && !s.deleted_at) || null;
  },

  async getSlipByFileHash(userId: string, hash: string): Promise<Slip | null> {
    assertUserId(userId);
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
    return dbState.slips
      .filter(
        (s) => s.user_id === userId && s.status === "needs_review" && !s.deleted_at
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async createSlip(userId: string, data: Partial<Slip>): Promise<Slip> {
    assertUserId(userId);
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
    return newSlip;
  },

  async updateSlip(
    userId: string,
    id: string,
    data: Partial<Slip>
  ): Promise<Slip> {
    assertUserId(userId);
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
      user_id: userId,
      id: current.id,
    };

    dbState.slips[idx] = updated;
    return updated;
  },

  // SLIP JOBS
  async createSlipJob(
    userId: string,
    data: Partial<SlipIngestionJob>
  ): Promise<SlipIngestionJob> {
    assertUserId(userId);
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
    return job;
  },

  async updateSlipJob(
    userId: string,
    id: string,
    data: Partial<SlipIngestionJob>
  ): Promise<SlipIngestionJob> {
    assertUserId(userId);
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
    return updated;
  },

  async getSlipJobById(
    userId: string,
    id: string
  ): Promise<SlipIngestionJob | null> {
    assertUserId(userId);
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
    return correction;
  },

  async getSlipCorrections(
    userId: string,
    slipId?: string
  ): Promise<SlipCorrection[]> {
    assertUserId(userId);
    return dbState.slip_corrections.filter(
      (c) => c.user_id === userId && (!slipId || c.slip_id === slipId)
    );
  },

  // PRIVATE STORAGE (In-memory buffer)
  async saveSlipFile(storagePath: string, buffer: Buffer): Promise<void> {
    memorySlipFiles.set(storagePath, buffer);
  },

  async getSlipFile(storagePath: string): Promise<Buffer | null> {
    return memorySlipFiles.get(storagePath) || null;
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

  // Account Match Aliases
  async getAccountMatchAliases(userId: string): Promise<AccountMatchAlias[]> {
    assertUserId(userId);
    return dbState.account_match_aliases.filter((a) => a.user_id === userId);
  },

  async recordAccountMatchAlias(
    userId: string,
    data: {
      account_id: string;
      institution?: string | null;
      raw_masked_pattern?: string | null;
      normalized_masked_pattern: string;
      source?: string;
      confirmed_count?: number;
    }
  ): Promise<AccountMatchAlias> {
    assertUserId(userId);
    const accountExists = dbState.accounts.some(
      (a) => a.id === data.account_id && a.user_id === userId
    );
    if (!accountExists) {
      throw new Error(`Account ${data.account_id} not found or access denied`);
    }

    // Financial safety guard: verified alias must contain at least 3 visible digits
    if (!hasSufficientVisibleDigits(data.normalized_masked_pattern, 3)) {
      throw new Error(
        `Cannot record account match alias: normalized pattern must contain at least 3 visible digits, got ${countVisibleDigits(data.normalized_masked_pattern)}`
      );
    }

    const normBank = (data.institution && normalizeBankName(data.institution)) || "UNKNOWN";
    const existing = dbState.account_match_aliases.find(
      (a) =>
        a.user_id === userId &&
        a.account_id === data.account_id &&
        (a.institution || "UNKNOWN") === normBank &&
        a.normalized_masked_pattern === data.normalized_masked_pattern
    );

    if (existing) {
      // Idempotency: backfill sets deterministic count; manual learning increments
      if (data.source === "backfill") {
        if (data.confirmed_count !== undefined) {
          existing.confirmed_count = data.confirmed_count;
        }
      } else {
        existing.confirmed_count += 1;
      }
      if (data.raw_masked_pattern) existing.raw_masked_pattern = data.raw_masked_pattern;
      existing.updated_at = new Date().toISOString();
      if (data.source) existing.source = data.source;
      return existing;
    }

    const now = new Date().toISOString();
    const newAlias: AccountMatchAlias = {
      id: crypto.randomUUID(),
      user_id: userId,
      account_id: data.account_id,
      institution: normBank,
      raw_masked_pattern: data.raw_masked_pattern || null,
      normalized_masked_pattern: data.normalized_masked_pattern,
      source: data.source || "manual_confirm",
      confirmed_count: data.confirmed_count ?? 1,
      created_at: now,
      updated_at: now,
    };

    dbState.account_match_aliases.push(newAlias);
    return newAlias;
  },

  async backfillAccountMatchAliases(
    userId: string
  ): Promise<{ created: number; skipped: number }> {
    assertUserId(userId);
    let created = 0;
    let skipped = 0;

    // Filter strictly by human-verified transactions (review_status = 'corrected')
    // Old auto-created confirmed transactions are NOT used for backfill.
    const verifiedTxs = dbState.transactions.filter(
      (t) =>
        t.user_id === userId &&
        Boolean(t.source_slip_id) &&
        t.review_status === "corrected"
    );

    interface BackfillCandidate {
      accountId: string;
      institution: string;
      rawMask: string;
      normalizedPattern: string;
    }

    const candidates: BackfillCandidate[] = [];

    for (const tx of verifiedTxs) {
      const slip = dbState.slips.find(
        (s) => s.id === tx.source_slip_id && s.user_id === userId
      );
      if (!slip || !slip.extracted_json) continue;

      if (tx.from_account_id && slip.extracted_json.sender?.accountMasked) {
        const rawMask = slip.extracted_json.sender.accountMasked;
        const pattern = normalizeMaskedPattern(rawMask);
        // Financial safety guard: must have >= 3 visible digits
        if (hasSufficientVisibleDigits(pattern, 3)) {
          const bank = normalizeBankName(slip.extracted_json.sender.bank) || "UNKNOWN";
          candidates.push({
            accountId: tx.from_account_id,
            institution: bank,
            rawMask,
            normalizedPattern: pattern,
          });
        }
      }

      if (tx.to_account_id && slip.extracted_json.receiver?.accountMasked) {
        const rawMask = slip.extracted_json.receiver.accountMasked;
        const pattern = normalizeMaskedPattern(rawMask);
        // Financial safety guard: must have >= 3 visible digits
        if (hasSufficientVisibleDigits(pattern, 3)) {
          const bank = normalizeBankName(slip.extracted_json.receiver.bank) || "UNKNOWN";
          candidates.push({
            accountId: tx.to_account_id,
            institution: bank,
            rawMask,
            normalizedPattern: pattern,
          });
        }
      }
    }

    // Check if any (institution, pattern) maps to multiple distinct accounts
    const patternAccountsMap = new Map<string, Set<string>>();
    for (const c of candidates) {
      const pKey = `${c.institution}::${c.normalizedPattern}`;
      if (!patternAccountsMap.has(pKey)) patternAccountsMap.set(pKey, new Set());
      patternAccountsMap.get(pKey)!.add(c.accountId);
    }

    // Deduplicate and group by the actual UNIQUE key:
    // (account_id, institution, normalized_masked_pattern)
    // Ensures differently formatted raw masks (e.g. xxx-x-x7520-x and xxxxx7520x) produce exactly ONE alias!
    interface GroupedAlias {
      accountId: string;
      institution: string;
      normalizedPattern: string;
      rawMasks: string[];
      count: number;
    }

    const grouped = new Map<string, GroupedAlias>();

    for (const c of candidates) {
      const pKey = `${c.institution}::${c.normalizedPattern}`;
      if (patternAccountsMap.get(pKey)?.size !== 1) {
        skipped++;
        continue;
      }

      const uniqueKey = `${c.accountId}::${c.institution}::${c.normalizedPattern}`;
      if (!grouped.has(uniqueKey)) {
        grouped.set(uniqueKey, {
          accountId: c.accountId,
          institution: c.institution,
          normalizedPattern: c.normalizedPattern,
          rawMasks: [],
          count: 0,
        });
      }
      const entry = grouped.get(uniqueKey)!;
      entry.rawMasks.push(c.rawMask);
      entry.count++;
    }

    for (const entry of grouped.values()) {
      // Deterministic representative raw_masked_pattern
      const repRawMask = [...entry.rawMasks].sort()[0];
      await this.recordAccountMatchAlias(userId, {
        account_id: entry.accountId,
        institution: entry.institution,
        raw_masked_pattern: repRawMask,
        normalized_masked_pattern: entry.normalizedPattern,
        source: "backfill",
        confirmed_count: entry.count,
      });
      created++;
    }

    return { created, skipped };
  },

  // Atomic Slip Confirmation
  async confirmSlipTransaction(
    userId: string,
    input: ConfirmSlipTransactionInput
  ): Promise<ConfirmSlipTransactionResult> {
    assertUserId(userId);

    // Domain validation 1: Allowed transaction types for slip confirmation
    if (
      !input.type ||
      !["income", "expense", "transfer"].includes(input.type)
    ) {
      throw new Error(
        `Invalid transaction type ${input.type}: confirmation only allows income, expense, or transfer`
      );
    }

    // Domain validation 2: Allowed review status
    const reviewStatus = input.review_status || "confirmed";
    if (!["confirmed", "corrected"].includes(reviewStatus)) {
      throw new Error(
        `Invalid review_status ${input.review_status}: only confirmed or corrected allowed`
      );
    }

    // Domain validation 3: Amount > 0 and finite
    const numAmount = Number(input.amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      throw new Error("Invalid amount: must be greater than 0");
    }

    // Domain validation 4: Transaction date required
    if (!input.transaction_date) {
      throw new Error("Transaction date is required");
    }

    // Domain validation 5: Account requirements
    if (input.type === "transfer") {
      if (!input.from_account_id || !input.to_account_id) {
        throw new Error("Transfer requires both from_account_id and to_account_id");
      }
      if (input.from_account_id === input.to_account_id) {
        throw new Error("Source and destination accounts must not be identical");
      }
    } else if (input.type === "expense") {
      if (!input.from_account_id) {
        throw new Error("Expense requires from_account_id");
      }
      if (input.to_account_id) {
        throw new Error("Expense must not have to_account_id");
      }
    } else if (input.type === "income") {
      if (!input.to_account_id) {
        throw new Error("Income requires to_account_id");
      }
      if (input.from_account_id) {
        throw new Error("Income must not have from_account_id");
      }
    }

    // Defense-in-depth: Foreign ID ownership checks
    if (input.from_account_id) {
      const exists = dbState.accounts.some(
        (a) => a.id === input.from_account_id && a.user_id === userId
      );
      if (!exists) {
        throw new Error(`Security violation: foreign source account does not belong to user ${userId}`);
      }
    }
    if (input.to_account_id) {
      const exists = dbState.accounts.some(
        (a) => a.id === input.to_account_id && a.user_id === userId
      );
      if (!exists) {
        throw new Error(`Security violation: foreign destination account does not belong to user ${userId}`);
      }
    }
    if (input.category_id) {
      const exists = dbState.categories.some(
        (c) => c.id === input.category_id && (c.user_id === userId || c.is_system)
      );
      if (!exists) {
        throw new Error(`Security violation: foreign category does not belong to user ${userId}`);
      }
    }
    if (input.merchant_id) {
      const exists = dbState.merchants.some(
        (m) => m.id === input.merchant_id && m.user_id === userId
      );
      if (!exists) {
        throw new Error(`Security violation: foreign merchant does not belong to user ${userId}`);
      }
    }
    if (input.person_id) {
      const exists = dbState.people.some(
        (p) => p.id === input.person_id && p.user_id === userId
      );
      if (!exists) {
        throw new Error(`Security violation: foreign person does not belong to user ${userId}`);
      }
    }

    const slip = await this.getSlipById(userId, input.slipId);
    if (!slip) {
      throw new Error("Slip not found or access denied");
    }

    // 1. Idempotency Tier 1: Check if slip already has linked_transaction_id
    if (slip.linked_transaction_id) {
      const existingTx = await this.getTransactionById(userId, slip.linked_transaction_id);
      if (existingTx) {
        return { transaction: existingTx, alreadyConfirmed: true };
      }
    }

    // 2. Idempotency Tier 2: Check if transaction already exists for source_slip_id
    const existingBySlip = dbState.transactions.find(
      (t) => t.source_slip_id === input.slipId && t.user_id === userId
    );
    if (existingBySlip) {
      slip.status = "created";
      slip.linked_transaction_id = existingBySlip.id;
      slip.processed_at = slip.processed_at || new Date().toISOString();
      return { transaction: existingBySlip, alreadyConfirmed: true };
    }

    // 3. Validate status
    if (
      slip.status !== "needs_review" &&
      slip.status !== "created" &&
      slip.status !== "processing"
    ) {
      throw new Error(
        `Slip status is ${slip.status}; only slips in needs_review or processing can be confirmed`
      );
    }

    // 4. Create transaction
    const newTx = await this.createTransaction(userId, {
      type: input.type,
      amount: numAmount,
      currency: input.currency || "THB",
      transaction_date: input.transaction_date,
      description: input.description || null,
      note: input.note || null,
      from_account_id: input.from_account_id || null,
      to_account_id: input.to_account_id || null,
      category_id: input.category_id || null,
      merchant_id: input.merchant_id || null,
      person_id: input.person_id || null,
      source: "slip",
      source_slip_id: input.slipId,
      reference_number: input.reference_number || null,
      confidence: input.confidence !== undefined ? input.confidence : 1.0,
      review_status: reviewStatus,
    });

    // 5. Update slip atomically (with rollback safeguard)
    try {
      await this.updateSlip(userId, input.slipId, {
        status: "created",
        linked_transaction_id: newTx.id,
        processed_at: new Date().toISOString(),
      });
      return { transaction: newTx, alreadyConfirmed: false };
    } catch (err) {
      // Rollback inserted transaction so no orphaned transaction exists
      const txIdx = dbState.transactions.findIndex((t) => t.id === newTx.id);
      if (txIdx !== -1) {
        dbState.transactions.splice(txIdx, 1);
      }
      throw err;
    }
  },

  // Reset database for tests
  reset(initialState?: MemoryDatabaseState) {
    globalForMemory.__finn_memory_db__ = initialState
      ? JSON.parse(JSON.stringify(initialState))
      : getInitialState();
    getMemorySlipFiles().clear();
  },
};
