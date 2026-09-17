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
import { StorageRetentionSettings, StorageBinaryEvent } from "@/types/storage";

export interface PreloadedRelations {
  accounts?: Account[];
  categories?: Category[];
  people?: Person[];
  merchants?: Merchant[];
}

export interface TransactionsPageData {
  transactions: TransactionWithRelations[];
  accounts: Account[];
  categories: Category[];
  people: Person[];
  merchants: Merchant[];
}

export interface IDataStore {
  // Accounts
  getAccounts(userId: string): Promise<Account[]>;
  getAllAccounts(userId: string): Promise<Account[]>;
  getAccountById(userId: string, id: string): Promise<Account | null>;
  createAccount(userId: string, data: AccountInput | AccountFormData): Promise<Account>;
  updateAccount(userId: string, id: string, data: Partial<AccountFormData>): Promise<Account>;
  archiveAccount(userId: string, id: string): Promise<void>;

  // Categories
  getCategories(userId: string): Promise<Category[]>;
  createCategory(userId: string, data: CategoryFormData): Promise<Category>;

  // People
  getPeople(userId: string): Promise<Person[]>;
  getPersonById(userId: string, id: string): Promise<Person | null>;
  createPerson(userId: string, data: PersonFormData): Promise<Person>;
  updatePerson(userId: string, id: string, data: Partial<PersonFormData>): Promise<Person>;

  // Merchants
  getMerchants(userId: string): Promise<Merchant[]>;
  getMerchantById(userId: string, id: string): Promise<Merchant | null>;
  createMerchant(userId: string, data: MerchantFormData): Promise<Merchant>;
  updateMerchant(userId: string, id: string, data: Partial<MerchantFormData>): Promise<Merchant>;

  // Transactions
  getTransactions(userId: string, preloadedRelations?: PreloadedRelations): Promise<TransactionWithRelations[]>;
  getTransactionsIncludingVoided(userId: string, preloadedRelations?: PreloadedRelations): Promise<TransactionWithRelations[]>;
  getTransactionsPageData(userId: string): Promise<TransactionsPageData>;
  getTransactionsPageDataIncludingVoided(userId: string): Promise<TransactionsPageData>;
  getTransactionById(userId: string, id: string, preloadedRelations?: PreloadedRelations): Promise<TransactionWithRelations | null>;
  createTransaction(userId: string, data: TransactionInput | TransactionFormData): Promise<Transaction>;
  updateTransaction(userId: string, id: string, data: Partial<TransactionFormData>): Promise<Transaction>;
  deleteTransaction(userId: string, id: string): Promise<void>;
  voidTransaction(userId: string, transactionId: string, reason: string): Promise<import("@/types/finance").VoidTransactionResult>;
  restoreTransaction(userId: string, transactionId: string, reason?: string): Promise<import("@/types/finance").RestoreTransactionResult>;
  getTransactionVoidEvents(userId: string, transactionId: string): Promise<import("@/types/finance").TransactionVoidEvent[]>;

  // Ingest Tokens
  getIngestTokens(userId: string): Promise<IngestToken[]>;
  createIngestToken(
    userId: string,
    data: { label: string; scope?: string; expires_at?: string | null }
  ): Promise<{ rawToken: string; record: IngestToken }>;
  verifyAndConsumeIngestToken(rawToken: string): Promise<IngestToken | null>;
  revokeIngestToken(userId: string, tokenId: string): Promise<void>;

  // Slips
  getSlips(userId: string): Promise<Slip[]>;
  getSlipById(userId: string, id: string): Promise<Slip | null>;
  getSlipByIdUnscoped(id: string): Promise<Slip | null>;
  getSlipByFileHash(userId: string, hash: string): Promise<Slip | null>;
  getPendingReviewSlips(userId: string): Promise<Slip[]>;
  createSlip(userId: string, data: Partial<Slip>): Promise<Slip>;
  updateSlip(userId: string, id: string, data: Partial<Slip>): Promise<Slip>;

  // Slip Jobs
  createSlipJob(userId: string, data: Partial<SlipIngestionJob>): Promise<SlipIngestionJob>;
  updateSlipJob(userId: string, id: string, data: Partial<SlipIngestionJob>): Promise<SlipIngestionJob>;
  getSlipJobById(userId: string, id: string): Promise<SlipIngestionJob | null>;

  // Slip Corrections
  createSlipCorrection(userId: string, data: Partial<SlipCorrection>): Promise<SlipCorrection>;
  getSlipCorrections(userId: string, slipId?: string): Promise<SlipCorrection[]>;

  // Account Match Aliases
  getAccountMatchAliases(userId: string): Promise<import("@/types/slip").AccountMatchAlias[]>;
  recordAccountMatchAlias(
    userId: string,
    data: {
      account_id: string;
      institution?: string | null;
      raw_masked_pattern?: string | null;
      normalized_masked_pattern: string;
      source?: string;
      confirmed_count?: number;
    }
  ): Promise<import("@/types/slip").AccountMatchAlias>;
  backfillAccountMatchAliases(userId: string): Promise<{ created: number; skipped: number }>;

  // Storage
  saveSlipFile(storagePath: string, buffer: Buffer): Promise<void>;
  getSlipFile(storagePath: string): Promise<Buffer | null>;
  deleteSlipFile(storagePath: string): Promise<void>;
  slipFileExists(storagePath: string): Promise<boolean>;
  createSignedSlipUrl(userId: string, slipId: string, expiresInSeconds?: number): Promise<string>;
  verifySlipPreviewSignature(slipId: string, exp: number, sig: string): boolean;

  // Storage Retention & Pinned Evidence
  getStorageRetentionSettings(userId: string): Promise<StorageRetentionSettings>;
  updateStorageRetentionSettings(
    userId: string,
    data: Partial<StorageRetentionSettings>
  ): Promise<StorageRetentionSettings>;
  createStorageBinaryEvent(
    userId: string,
    data: Omit<StorageBinaryEvent, "id" | "created_at">
  ): Promise<StorageBinaryEvent>;
  getStorageBinaryEvents(
    userId: string,
    filter?: { slipId?: string; sourceDocumentId?: string; limit?: number }
  ): Promise<StorageBinaryEvent[]>;
  setSlipPinned(userId: string, slipId: string, isPinned: boolean): Promise<Slip>;
  setSourceDocumentPinned(userId: string, docId: string, isPinned: boolean): Promise<SourceDocument>;

  // Atomic Slip Confirmation
  confirmSlipTransaction(
    userId: string,
    input: ConfirmSlipTransactionInput
  ): Promise<ConfirmSlipTransactionResult>;

  // Source Connections
  getSourceConnections(userId: string): Promise<SourceConnection[]>;
  getSourceConnectionById(userId: string, id: string): Promise<SourceConnection | null>;
  createSourceConnection(userId: string, data: Partial<SourceConnection>): Promise<SourceConnection>;
  updateSourceConnection(userId: string, id: string, data: Partial<SourceConnection>): Promise<SourceConnection>;
  deleteSourceConnection(userId: string, id: string): Promise<void>;

  // Source Documents
  getSourceDocuments(userId: string): Promise<SourceDocument[]>;
  getSourceDocumentById(userId: string, id: string): Promise<SourceDocument | null>;
  getSourceDocumentByHash(userId: string, hash: string): Promise<SourceDocument | null>;
  createSourceDocument(userId: string, data: Partial<SourceDocument>): Promise<SourceDocument>;
  updateSourceDocument(userId: string, id: string, data: Partial<SourceDocument>): Promise<SourceDocument>;

  // Import Batches
  getImportBatches(userId: string): Promise<ImportBatch[]>;
  getImportBatchById(userId: string, id: string): Promise<ImportBatch | null>;
  createImportBatch(userId: string, data: Partial<ImportBatch>): Promise<ImportBatch>;
  updateImportBatch(userId: string, id: string, data: Partial<ImportBatch>): Promise<ImportBatch>;

  // Ingestion Items
  getIngestionItems(userId: string, filter?: { status?: string; sourceDocumentId?: string }): Promise<IngestionItem[]>;
  getIngestionItemById(userId: string, id: string): Promise<IngestionItem | null>;
  createIngestionItems(userId: string, items: Array<Partial<IngestionItem>>): Promise<IngestionItem[]>;
  updateIngestionItem(userId: string, id: string, data: Partial<IngestionItem>): Promise<IngestionItem>;

  // Transaction Evidence Bridge
  getTransactionEvidence(userId: string, transactionId: string): Promise<TransactionEvidence[]>;
  createTransactionEvidence(userId: string, data: Partial<TransactionEvidence>): Promise<TransactionEvidence>;

  // Reconciliation Runs (Audit Snapshots - Append Only)
  getReconciliationRuns(userId: string, accountId?: string): Promise<ReconciliationRun[]>;
  createReconciliationRun(userId: string, data: Partial<ReconciliationRun>): Promise<ReconciliationRun>;

  // Atomic Create Transaction from Ingestion Item
  createTransactionFromIngestionItem(
    userId: string,
    itemId: string,
    txData: Omit<Transaction, "id" | "created_at" | "updated_at" | "user_id">
  ): Promise<{ transaction: Transaction; evidence: TransactionEvidence; item: IngestionItem }>;

  // Atomic Link Ingestion Item to Transaction
  linkIngestionItemToTransaction(
    userId: string,
    itemId: string,
    transactionId: string
  ): Promise<{ evidence: TransactionEvidence; item: IngestionItem }>;

  // Test reset helper
  reset(initialState?: unknown): void;
}

export interface ConfirmSlipTransactionInput {
  slipId: string;
  type: import("@/types/finance").TransactionType;
  amount: number;
  currency?: string;
  transaction_date: string;
  description?: string | null;
  note?: string | null;
  from_account_id?: string | null;
  to_account_id?: string | null;
  category_id?: string | null;
  merchant_id?: string | null;
  person_id?: string | null;
  reference_number?: string | null;
  confidence?: number;
  review_status?: import("@/types/finance").ReviewStatus;
}

export interface ConfirmSlipTransactionResult {
  transaction: Transaction;
  alreadyConfirmed: boolean;
}
