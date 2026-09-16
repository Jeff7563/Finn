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
  getTransactionsPageData(userId: string): Promise<TransactionsPageData>;
  getTransactionById(userId: string, id: string, preloadedRelations?: PreloadedRelations): Promise<TransactionWithRelations | null>;
  createTransaction(userId: string, data: TransactionInput | TransactionFormData): Promise<Transaction>;
  updateTransaction(userId: string, id: string, data: Partial<TransactionFormData>): Promise<Transaction>;
  deleteTransaction(userId: string, id: string): Promise<void>;

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
    }
  ): Promise<import("@/types/slip").AccountMatchAlias>;
  backfillAccountMatchAliases(userId: string): Promise<{ created: number; skipped: number }>;

  // Storage
  saveSlipFile(storagePath: string, buffer: Buffer): Promise<void>;
  getSlipFile(storagePath: string): Promise<Buffer | null>;
  createSignedSlipUrl(userId: string, slipId: string, expiresInSeconds?: number): Promise<string>;
  verifySlipPreviewSignature(slipId: string, exp: number, sig: string): boolean;

  // Atomic Slip Confirmation
  confirmSlipTransaction(
    userId: string,
    input: ConfirmSlipTransactionInput
  ): Promise<ConfirmSlipTransactionResult>;

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
