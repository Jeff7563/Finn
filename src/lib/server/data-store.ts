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
}

const LOCAL_STORAGE_FILE = path.resolve(process.cwd(), ".local-db.json");

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
  };
}

function loadLocalDatabase(): LocalDatabaseState {
  try {
    if (fs.existsSync(LOCAL_STORAGE_FILE)) {
      const data = fs.readFileSync(LOCAL_STORAGE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // fallback
  }
  const init = getInitialState();
  saveLocalDatabase(init);
  return init;
}

function saveLocalDatabase(state: LocalDatabaseState) {
  try {
    fs.writeFileSync(LOCAL_STORAGE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // Ignore in read-only filesystems
  }
}

// Memory cache
let dbState: LocalDatabaseState = loadLocalDatabase();

export const DataStore = {
  // ACCOUNTS
  async getAccounts(userId: string): Promise<Account[]> {
    dbState = loadLocalDatabase();
    return dbState.accounts.filter((a) => a.user_id === userId && a.active);
  },

  async getAllAccounts(userId: string): Promise<Account[]> {
    dbState = loadLocalDatabase();
    return dbState.accounts.filter((a) => a.user_id === userId);
  },

  async getAccountById(userId: string, id: string): Promise<Account | null> {
    dbState = loadLocalDatabase();
    return (
      dbState.accounts.find((a) => a.id === id && a.user_id === userId) || null
    );
  },

  async createAccount(
    userId: string,
    data: AccountInput | AccountFormData
  ): Promise<Account> {
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
    dbState = loadLocalDatabase();
    const idx = dbState.accounts.findIndex(
      (a) => a.id === id && a.user_id === userId
    );
    if (idx === -1) throw new Error("Account not found");

    dbState.accounts[idx].active = false;
    dbState.accounts[idx].updated_at = new Date().toISOString();
    saveLocalDatabase(dbState);
  },

  // CATEGORIES
  async getCategories(userId: string): Promise<Category[]> {
    dbState = loadLocalDatabase();
    return dbState.categories.filter(
      (c) => c.is_system || c.user_id === userId
    );
  },

  async createCategory(
    userId: string,
    data: CategoryFormData
  ): Promise<Category> {
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
    dbState = loadLocalDatabase();
    return dbState.people.filter((p) => p.user_id === userId);
  },

  async getPersonById(userId: string, id: string): Promise<Person | null> {
    dbState = loadLocalDatabase();
    return (
      dbState.people.find((p) => p.id === id && p.user_id === userId) || null
    );
  },

  async createPerson(userId: string, data: PersonFormData): Promise<Person> {
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
    dbState = loadLocalDatabase();
    const idx = dbState.people.findIndex(
      (p) => p.id === id && p.user_id === userId
    );
    if (idx === -1) throw new Error("Person not found");

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
    dbState = loadLocalDatabase();
    return dbState.merchants.filter((m) => m.user_id === userId);
  },

  async getMerchantById(userId: string, id: string): Promise<Merchant | null> {
    dbState = loadLocalDatabase();
    return (
      dbState.merchants.find((m) => m.id === id && m.user_id === userId) || null
    );
  },

  async createMerchant(
    userId: string,
    data: MerchantFormData
  ): Promise<Merchant> {
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
    dbState = loadLocalDatabase();
    const idx = dbState.merchants.findIndex(
      (m) => m.id === id && m.user_id === userId
    );
    if (idx === -1) throw new Error("Merchant not found");

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
      if (!exists) throw new Error("Invalid source account");
    }

    if (data.to_account_id) {
      const exists = dbState.accounts.some(
        (a) => a.id === data.to_account_id && a.user_id === userId
      );
      if (!exists) throw new Error("Invalid destination account");
    }

    if (data.person_id) {
      const exists = dbState.people.some(
        (p) => p.id === data.person_id && p.user_id === userId
      );
      if (!exists) throw new Error("Invalid counterparty person");
    }

    if (data.merchant_id) {
      const exists = dbState.merchants.some(
        (m) => m.id === data.merchant_id && m.user_id === userId
      );
      if (!exists) throw new Error("Invalid merchant");
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
      amount: Number(data.amount),
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
      reference_number: data.reference_number || null,
      tax_income_type: data.tax_income_type || null,
      tax_deductible: data.tax_deductible ?? false,
      tax_year: data.tax_year || null,
      confidence: 1.0,
      review_status: "confirmed",
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
    dbState = loadLocalDatabase();
    const idx = dbState.transactions.findIndex(
      (t) => t.id === id && t.user_id === userId
    );
    if (idx === -1) throw new Error("Transaction not found");

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
    const type = data.type || current.type;

    if (type === "transfer") {
      if (!fromId || !toId || fromId === toId) {
        throw new Error("Invalid transfer accounts");
      }
    }

    const updated: Transaction = {
      ...current,
      type,
      amount: data.amount !== undefined ? Number(data.amount) : current.amount,
      currency: data.currency || current.currency,
      transaction_date: data.transaction_date || current.transaction_date,
      description:
        data.description !== undefined ? data.description : current.description,
      note: data.note !== undefined ? data.note : current.note,
      from_account_id: fromId,
      to_account_id: toId,
      person_id:
        data.person_id !== undefined ? data.person_id : current.person_id,
      merchant_id:
        data.merchant_id !== undefined ? data.merchant_id : current.merchant_id,
      category_id:
        data.category_id !== undefined ? data.category_id : current.category_id,
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
    dbState = loadLocalDatabase();
    const idx = dbState.transactions.findIndex(
      (t) => t.id === id && t.user_id === userId
    );
    if (idx === -1) throw new Error("Transaction not found");

    dbState.transactions.splice(idx, 1);
    saveLocalDatabase(dbState);
  },

  // Reset database for tests
  reset(initialState?: LocalDatabaseState) {
    dbState = initialState || getInitialState();
    saveLocalDatabase(dbState);
  },
};
