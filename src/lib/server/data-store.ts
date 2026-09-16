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
import {
  SourceConnection,
  SourceDocument,
  ImportBatch,
  IngestionItem,
  TransactionEvidence,
  ReconciliationRun,
} from "@/types/multi-source";
import {
  IDataStore,
  PreloadedRelations,
  TransactionsPageData,
  ConfirmSlipTransactionInput,
  ConfirmSlipTransactionResult,
} from "./data-store-interface";
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
  async getTransactions(
    userId: string,
    preloadedRelations?: PreloadedRelations
  ): Promise<TransactionWithRelations[]> {
    return getActiveStore().getTransactions(userId, preloadedRelations);
  },

  async getTransactionsPageData(
    userId: string
  ): Promise<TransactionsPageData> {
    return getActiveStore().getTransactionsPageData(userId);
  },

  async getTransactionById(
    userId: string,
    id: string,
    preloadedRelations?: PreloadedRelations
  ): Promise<TransactionWithRelations | null> {
    return getActiveStore().getTransactionById(userId, id, preloadedRelations);
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

  async getSlipCorrections(
    userId: string,
    slipId?: string
  ): Promise<SlipCorrection[]> {
    return getActiveStore().getSlipCorrections(userId, slipId);
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

  // ACCOUNT MATCH ALIASES
  async getAccountMatchAliases(userId: string): Promise<import("@/types/slip").AccountMatchAlias[]> {
    return getActiveStore().getAccountMatchAliases(userId);
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
  ): Promise<import("@/types/slip").AccountMatchAlias> {
    return getActiveStore().recordAccountMatchAlias(userId, data);
  },

  async backfillAccountMatchAliases(
    userId: string
  ): Promise<{ created: number; skipped: number }> {
    return getActiveStore().backfillAccountMatchAliases(userId);
  },

  // Atomic Slip Confirmation
  async confirmSlipTransaction(
    userId: string,
    input: ConfirmSlipTransactionInput
  ): Promise<ConfirmSlipTransactionResult> {
    return getActiveStore().confirmSlipTransaction(userId, input);
  },

  // Source Connections
  async getSourceConnections(userId: string): Promise<SourceConnection[]> {
    return getActiveStore().getSourceConnections(userId);
  },

  async getSourceConnectionById(userId: string, id: string): Promise<SourceConnection | null> {
    return getActiveStore().getSourceConnectionById(userId, id);
  },

  async createSourceConnection(
    userId: string,
    data: Partial<SourceConnection>
  ): Promise<SourceConnection> {
    return getActiveStore().createSourceConnection(userId, data);
  },

  async updateSourceConnection(
    userId: string,
    id: string,
    data: Partial<SourceConnection>
  ): Promise<SourceConnection> {
    return getActiveStore().updateSourceConnection(userId, id, data);
  },

  async deleteSourceConnection(userId: string, id: string): Promise<void> {
    return getActiveStore().deleteSourceConnection(userId, id);
  },

  // Source Documents
  async getSourceDocuments(userId: string): Promise<SourceDocument[]> {
    return getActiveStore().getSourceDocuments(userId);
  },

  async getSourceDocumentById(userId: string, id: string): Promise<SourceDocument | null> {
    return getActiveStore().getSourceDocumentById(userId, id);
  },

  async createSourceDocument(
    userId: string,
    data: Partial<SourceDocument>
  ): Promise<SourceDocument> {
    return getActiveStore().createSourceDocument(userId, data);
  },

  // Import Batches
  async getImportBatches(userId: string): Promise<ImportBatch[]> {
    return getActiveStore().getImportBatches(userId);
  },

  async getImportBatchById(userId: string, id: string): Promise<ImportBatch | null> {
    return getActiveStore().getImportBatchById(userId, id);
  },

  async createImportBatch(
    userId: string,
    data: Partial<ImportBatch>
  ): Promise<ImportBatch> {
    return getActiveStore().createImportBatch(userId, data);
  },

  async updateImportBatch(
    userId: string,
    id: string,
    data: Partial<ImportBatch>
  ): Promise<ImportBatch> {
    return getActiveStore().updateImportBatch(userId, id, data);
  },

  // Ingestion Items
  async getIngestionItems(
    userId: string,
    filter?: { status?: string; sourceDocumentId?: string }
  ): Promise<IngestionItem[]> {
    return getActiveStore().getIngestionItems(userId, filter);
  },

  async getIngestionItemById(userId: string, id: string): Promise<IngestionItem | null> {
    return getActiveStore().getIngestionItemById(userId, id);
  },

  async createIngestionItems(
    userId: string,
    items: Array<Partial<IngestionItem>>
  ): Promise<IngestionItem[]> {
    return getActiveStore().createIngestionItems(userId, items);
  },

  async updateIngestionItem(
    userId: string,
    id: string,
    data: Partial<IngestionItem>
  ): Promise<IngestionItem> {
    return getActiveStore().updateIngestionItem(userId, id, data);
  },

  // Transaction Evidence Bridge
  async getTransactionEvidence(
    userId: string,
    transactionId: string
  ): Promise<TransactionEvidence[]> {
    return getActiveStore().getTransactionEvidence(userId, transactionId);
  },

  async createTransactionEvidence(
    userId: string,
    data: Partial<TransactionEvidence>
  ): Promise<TransactionEvidence> {
    return getActiveStore().createTransactionEvidence(userId, data);
  },

  // Reconciliation Runs
  async getReconciliationRuns(
    userId: string,
    accountId?: string
  ): Promise<ReconciliationRun[]> {
    return getActiveStore().getReconciliationRuns(userId, accountId);
  },

  async createReconciliationRun(
    userId: string,
    data: Partial<ReconciliationRun>
  ): Promise<ReconciliationRun> {
    return getActiveStore().createReconciliationRun(userId, data);
  },

  async createTransactionFromIngestionItem(
    userId: string,
    itemId: string,
    txData: Omit<Transaction, "id" | "created_at" | "updated_at" | "user_id">
  ): Promise<{ transaction: Transaction; evidence: TransactionEvidence; item: IngestionItem }> {
    return getActiveStore().createTransactionFromIngestionItem(userId, itemId, txData);
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
