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
import {
  IngestToken,
  Slip,
  SlipIngestionJob,
  SlipCorrection,
} from "@/types/slip";
import { IDataStore } from "./data-store-interface";
import { SupabaseDataStore, SupabaseDataStoreImpl } from "./supabase-data-store";
import { MemoryDataStore, MemoryDatabaseState } from "./memory-data-store";
import { isSupabaseConfigured } from "../supabase/server";
import { isDemoModeAllowed } from "./session";

export function isAutomatedTestEnvironment(): boolean {
  return (
    process.env.VITEST === "true" ||
    process.env.PLAYWRIGHT_TEST === "1" ||
    process.env.NODE_ENV === "test" ||
    process.env.DATASTORE_MODE === "memory" ||
    (process.env.ENABLE_DEMO_MODE === "true" && !isSupabaseConfigured())
  );
}

export function isProductionEnvironment(): boolean {
  if (isAutomatedTestEnvironment()) {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

/**
 * Strategy Resolver:
 * - Production: ALWAYS uses SupabaseDataStore. Fails closed if Supabase is unavailable.
 *   Zero reliance on local filesystem (.local-db.json, .storage/slips) or memory fallback.
 * - Automated Tests: Uses MemoryDataStore to allow fast, deterministic offline testing.
 * - Development: Uses SupabaseDataStore if configured, or MemoryDataStore if demo mode is permitted.
 */
export function getActiveStore(): IDataStore {
  if (isProductionEnvironment()) {
    // Production MUST fail closed rather than falling back to local files or memory.
    return SupabaseDataStore;
  }

  // Automated test runners (Vitest / Playwright) use MemoryDataStore unless explicitly configured
  if (isAutomatedTestEnvironment() && process.env.DATASTORE_MODE !== "supabase") {
    return MemoryDataStore;
  }

  // If real Supabase credentials are configured in development
  if (isSupabaseConfigured()) {
    return SupabaseDataStore;
  }

  // Development fallback only if demo mode is allowed
  if (isDemoModeAllowed()) {
    return MemoryDataStore;
  }

  // Fail closed if unconfigured and demo mode disabled
  throw new Error(
    "DataStore Configuration Error: Supabase is required. Local filesystem storage is deprecated and disabled."
  );
}

export const DataStore: IDataStore = {
  // ACCOUNTS
  async getAccounts(userId: string): Promise<Account[]> {
    return getActiveStore().getAccounts(userId);
  },

  async getAllAccounts(userId: string): Promise<Account[]> {
    return getActiveStore().getAllAccounts(userId);
  },

  async getAccountById(userId: string, id: string): Promise<Account | null> {
    return getActiveStore().getAccountById(userId, id);
  },

  async createAccount(
    userId: string,
    data: AccountInput | AccountFormData
  ): Promise<Account> {
    return getActiveStore().createAccount(userId, data);
  },

  async updateAccount(
    userId: string,
    id: string,
    data: Partial<AccountFormData>
  ): Promise<Account> {
    return getActiveStore().updateAccount(userId, id, data);
  },

  async archiveAccount(userId: string, id: string): Promise<void> {
    return getActiveStore().archiveAccount(userId, id);
  },

  // CATEGORIES
  async getCategories(userId: string): Promise<Category[]> {
    return getActiveStore().getCategories(userId);
  },

  async createCategory(
    userId: string,
    data: CategoryFormData
  ): Promise<Category> {
    return getActiveStore().createCategory(userId, data);
  },

  // PEOPLE
  async getPeople(userId: string): Promise<Person[]> {
    return getActiveStore().getPeople(userId);
  },

  async getPersonById(userId: string, id: string): Promise<Person | null> {
    return getActiveStore().getPersonById(userId, id);
  },

  async createPerson(userId: string, data: PersonFormData): Promise<Person> {
    return getActiveStore().createPerson(userId, data);
  },

  async updatePerson(
    userId: string,
    id: string,
    data: Partial<PersonFormData>
  ): Promise<Person> {
    return getActiveStore().updatePerson(userId, id, data);
  },

  // MERCHANTS
  async getMerchants(userId: string): Promise<Merchant[]> {
    return getActiveStore().getMerchants(userId);
  },

  async getMerchantById(userId: string, id: string): Promise<Merchant | null> {
    return getActiveStore().getMerchantById(userId, id);
  },

  async createMerchant(
    userId: string,
    data: MerchantFormData
  ): Promise<Merchant> {
    return getActiveStore().createMerchant(userId, data);
  },

  async updateMerchant(
    userId: string,
    id: string,
    data: Partial<MerchantFormData>
  ): Promise<Merchant> {
    return getActiveStore().updateMerchant(userId, id, data);
  },

  // TRANSACTIONS
  async getTransactions(userId: string): Promise<TransactionWithRelations[]> {
    return getActiveStore().getTransactions(userId);
  },

  async getTransactionById(
    userId: string,
    id: string
  ): Promise<TransactionWithRelations | null> {
    return getActiveStore().getTransactionById(userId, id);
  },

  async createTransaction(
    userId: string,
    data: TransactionInput | TransactionFormData
  ): Promise<Transaction> {
    return getActiveStore().createTransaction(userId, data);
  },

  async updateTransaction(
    userId: string,
    id: string,
    data: Partial<TransactionFormData>
  ): Promise<Transaction> {
    return getActiveStore().updateTransaction(userId, id, data);
  },

  async deleteTransaction(userId: string, id: string): Promise<void> {
    return getActiveStore().deleteTransaction(userId, id);
  },

  // INGEST TOKENS
  async getIngestTokens(userId: string): Promise<IngestToken[]> {
    return getActiveStore().getIngestTokens(userId);
  },

  async createIngestToken(
    userId: string,
    data: { label: string; scope?: string; expires_at?: string | null }
  ): Promise<{ rawToken: string; record: IngestToken }> {
    return getActiveStore().createIngestToken(userId, data);
  },

  async verifyAndConsumeIngestToken(rawToken: string): Promise<IngestToken | null> {
    return getActiveStore().verifyAndConsumeIngestToken(rawToken);
  },

  async revokeIngestToken(userId: string, tokenId: string): Promise<void> {
    return getActiveStore().revokeIngestToken(userId, tokenId);
  },

  // SLIPS
  async getSlips(userId: string): Promise<Slip[]> {
    return getActiveStore().getSlips(userId);
  },

  async getSlipById(userId: string, id: string): Promise<Slip | null> {
    return getActiveStore().getSlipById(userId, id);
  },

  async getSlipByIdUnscoped(id: string): Promise<Slip | null> {
    return getActiveStore().getSlipByIdUnscoped(id);
  },

  async getSlipByFileHash(userId: string, hash: string): Promise<Slip | null> {
    return getActiveStore().getSlipByFileHash(userId, hash);
  },

  async getPendingReviewSlips(userId: string): Promise<Slip[]> {
    return getActiveStore().getPendingReviewSlips(userId);
  },

  async createSlip(userId: string, data: Partial<Slip>): Promise<Slip> {
    return getActiveStore().createSlip(userId, data);
  },

  async updateSlip(
    userId: string,
    id: string,
    data: Partial<Slip>
  ): Promise<Slip> {
    return getActiveStore().updateSlip(userId, id, data);
  },

  // SLIP JOBS
  async createSlipJob(
    userId: string,
    data: Partial<SlipIngestionJob>
  ): Promise<SlipIngestionJob> {
    return getActiveStore().createSlipJob(userId, data);
  },

  async updateSlipJob(
    userId: string,
    id: string,
    data: Partial<SlipIngestionJob>
  ): Promise<SlipIngestionJob> {
    return getActiveStore().updateSlipJob(userId, id, data);
  },

  async getSlipJobById(
    userId: string,
    id: string
  ): Promise<SlipIngestionJob | null> {
    return getActiveStore().getSlipJobById(userId, id);
  },

  // SLIP CORRECTIONS
  async createSlipCorrection(
    userId: string,
    data: Partial<SlipCorrection>
  ): Promise<SlipCorrection> {
    return getActiveStore().createSlipCorrection(userId, data);
  },

  // PRIVATE STORAGE
  async saveSlipFile(storagePath: string, buffer: Buffer): Promise<void> {
    return getActiveStore().saveSlipFile(storagePath, buffer);
  },

  async getSlipFile(storagePath: string): Promise<Buffer | null> {
    return getActiveStore().getSlipFile(storagePath);
  },

  async createSignedSlipUrl(
    userId: string,
    slipId: string,
    expiresInSeconds = 900
  ): Promise<string> {
    return getActiveStore().createSignedSlipUrl(userId, slipId, expiresInSeconds);
  },

  verifySlipPreviewSignature(slipId: string, exp: number, sig: string): boolean {
    return getActiveStore().verifySlipPreviewSignature(slipId, exp, sig);
  },

  // Reset database for tests
  reset(initialState?: MemoryDatabaseState) {
    if (isProductionEnvironment()) {
      throw new Error("DataStore.reset() is disabled in production environment.");
    }
    MemoryDataStore.reset?.(initialState);
  },
};

export { SupabaseDataStore, SupabaseDataStoreImpl, MemoryDataStore };
