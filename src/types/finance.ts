export type AccountType =
  | "bank"
  | "cash"
  | "e_wallet"
  | "credit_card"
  | "investment"
  | "other";

export type TransactionType =
  | "income"
  | "expense"
  | "transfer"
  | "refund"
  | "reimbursement"
  | "loan_received"
  | "loan_payment"
  | "gift"
  | "investment"
  | "adjustment";

export type ReviewStatus = "pending" | "confirmed" | "corrected" | "rejected";
export type TransactionSource = "manual" | "slip" | "import" | "shortcut";

export interface Profile {
  id: string;
  email?: string;
  display_name?: string;
  currency: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  institution?: string | null;
  type: AccountType;
  masked_number?: string | null;
  opening_balance: number;
  currency: string;
  active: boolean;
  balance_as_of?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  user_id?: string | null;
  name: string;
  type: "income" | "expense";
  icon?: string | null;
  color?: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface Person {
  id: string;
  user_id: string;
  display_name: string;
  normalized_name: string;
  aliases: string[];
  phone?: string | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Merchant {
  id: string;
  user_id: string;
  display_name: string;
  normalized_name: string;
  category_hint?: string | null;
  aliases: string[];
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  transaction_date: string;
  description?: string | null;
  note?: string | null;
  from_account_id?: string | null;
  to_account_id?: string | null;
  person_id?: string | null;
  merchant_id?: string | null;
  category_id?: string | null;
  payment_method?: string | null;
  source: TransactionSource;
  source_document_id?: string | null;
  source_slip_id?: string | null;
  reference_number?: string | null;
  tax_income_type?: string | null;
  tax_deductible: boolean;
  tax_year?: number | null;
  confidence: number;
  review_status: ReviewStatus;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionVoidEvent {
  id: string;
  user_id: string;
  transaction_id: string;
  action: "void" | "restore";
  reason?: string | null;
  created_at: string;
}

export interface VoidTransactionResult {
  success: boolean;
  already_voided?: boolean;
  transaction_id: string;
  voided_at?: string | null;
  void_reason?: string | null;
  event_id?: string;
}

export interface RestoreTransactionResult {
  success: boolean;
  already_active?: boolean;
  transaction_id: string;
  event_id?: string;
}

export interface TransactionReplacementEvent {
  id: string;
  user_id: string;
  slip_id: string;
  old_transaction_id: string;
  new_transaction_id: string;
  reason: string;
  created_at: string;
}

export interface ReplaceVoidedSlipTransactionInput {
  old_transaction_id: string;
  slip_id: string;
  reason: string;
  type: TransactionType;
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
}

export interface ReplaceVoidedSlipTransactionResult {
  success: boolean;
  transaction: Transaction;
  event: TransactionReplacementEvent;
}

export interface TransactionWithRelations extends Transaction {
  from_account?: Account | null;
  to_account?: Account | null;
  person?: Person | null;
  merchant?: Merchant | null;
  category?: Category | null;
  replacement_event?: TransactionReplacementEvent | null;
  replaced_by_event?: TransactionReplacementEvent | null;
}

export interface AccountBalance {
  account: Account;
  current_balance: number;
  transaction_count: number;
}

export interface MonthSummary {
  income_total: number;
  expense_total: number;
  net_cash_flow: number;
  savings_rate: number;
}

export interface CategorySummary {
  category_id: string;
  category_name: string;
  type: "income" | "expense";
  total: number;
  count: number;
  percentage: number;
}

export interface PersonSummary {
  person: Person;
  total_received: number; // Income received from this person
  total_paid: number; // Expense paid to this person
  net: number; // received - paid
  transaction_count: number;
}

export interface MerchantSummary {
  merchant: Merchant;
  total_spent: number;
  transaction_count: number;
  average_transaction: number;
  top_category_name?: string | null;
}
