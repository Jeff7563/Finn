import crypto from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";
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
  AccountMatchAlias,
} from "@/types/slip";
import { normalizeBankName } from "../slip/bank-normalization";
import { normalizeMaskedPattern } from "../slip/mask-pattern";
import {
  generateIngestToken,
  hashToken,
  verifyTokenHash,
  isTokenUsable,
} from "../slip/token";
import { createClient as createServerSupabaseClient } from "../supabase/server";
import { cache } from "react";
import { createAdminClient, hasAdminCredentials } from "../supabase/admin";
import {
  IDataStore,
  PreloadedRelations,
  TransactionsPageData,
  ConfirmSlipTransactionInput,
  ConfirmSlipTransactionResult,
} from "./data-store-interface";
import {
  withJwtSkewRetry,
  executeQueryWithSkewRetry,
  isTransientJwtSkewError,
} from "./jwt-resilience";
import { getAuthenticatedUser } from "./auth";
import { measurePerf } from "./perf";

const getCachedAccounts = cache(
  async (store: SupabaseDataStoreImpl, userId: string): Promise<Account[]> => {
    return store.fetchAccountsDirect(userId);
  }
);

const getCachedCategories = cache(
  async (store: SupabaseDataStoreImpl, userId: string): Promise<Category[]> => {
    return store.fetchCategoriesDirect(userId);
  }
);

const getCachedPeople = cache(
  async (store: SupabaseDataStoreImpl, userId: string): Promise<Person[]> => {
    return store.fetchPeopleDirect(userId);
  }
);

const getCachedMerchants = cache(
  async (store: SupabaseDataStoreImpl, userId: string): Promise<Merchant[]> => {
    return store.fetchMerchantsDirect(userId);
  }
);

function assertUserId(userId: unknown): asserts userId is string {
  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    throw new Error("Authentication required: valid user ID is mandatory");
  }
}

function detectMimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
    default:
      return "image/jpeg";
  }
}

// Mappers from Supabase snake_case rows to strongly-typed domain models
function mapAccount(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name),
    institution: row.institution ? String(row.institution) : null,
    type: row.type as Account["type"],
    masked_number: row.masked_number ? String(row.masked_number) : null,
    opening_balance: Number(row.opening_balance) || 0,
    currency: row.currency ? String(row.currency) : "THB",
    active: Boolean(row.active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapCategory(row: Record<string, unknown>): Category {
  return {
    id: String(row.id),
    user_id: row.user_id ? String(row.user_id) : undefined,
    name: String(row.name),
    type: row.type as Category["type"],
    icon: row.icon ? String(row.icon) : null,
    color: row.color ? String(row.color) : null,
    is_system: Boolean(row.is_system),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapPerson(row: Record<string, unknown>): Person {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    display_name: String(row.display_name),
    normalized_name: String(row.normalized_name),
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    phone: row.phone ? String(row.phone) : null,
    note: row.note ? String(row.note) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapMerchant(row: Record<string, unknown>): Merchant {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    display_name: String(row.display_name),
    normalized_name: String(row.normalized_name),
    category_hint: row.category_hint ? String(row.category_hint) : null,
    aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
    metadata: (row.metadata as Record<string, unknown>) || {},
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    type: row.type as Transaction["type"],
    amount: Number(row.amount),
    currency: row.currency ? String(row.currency) : "THB",
    transaction_date: String(row.transaction_date),
    description: row.description ? String(row.description) : null,
    note: row.note ? String(row.note) : null,
    from_account_id: row.from_account_id ? String(row.from_account_id) : null,
    to_account_id: row.to_account_id ? String(row.to_account_id) : null,
    person_id: row.person_id ? String(row.person_id) : null,
    merchant_id: row.merchant_id ? String(row.merchant_id) : null,
    category_id: row.category_id ? String(row.category_id) : null,
    payment_method: row.payment_method ? String(row.payment_method) : null,
    source: (row.source as Transaction["source"]) || "manual",
    source_document_id: row.source_document_id ? String(row.source_document_id) : null,
    source_slip_id: row.source_slip_id ? String(row.source_slip_id) : null,
    reference_number: row.reference_number ? String(row.reference_number) : null,
    tax_income_type: row.tax_income_type ? String(row.tax_income_type) : null,
    tax_deductible: Boolean(row.tax_deductible),
    tax_year: row.tax_year !== null && row.tax_year !== undefined ? Number(row.tax_year) : null,
    confidence: row.confidence !== null && row.confidence !== undefined ? Number(row.confidence) : 1.0,
    review_status: (row.review_status as Transaction["review_status"]) || "confirmed",
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapIngestToken(row: Record<string, unknown>): IngestToken {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    token_hash: String(row.token_hash),
    token_prefix: String(row.token_prefix),
    label: String(row.label),
    scope: String(row.scope),
    created_at: String(row.created_at),
    last_used_at: row.last_used_at ? String(row.last_used_at) : null,
    expires_at: row.expires_at ? String(row.expires_at) : null,
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
    metadata: (row.metadata as Record<string, unknown>) || {},
  };
}

function mapSlip(row: Record<string, unknown>): Slip {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    storage_path: String(row.storage_path),
    file_hash_sha256: String(row.file_hash_sha256),
    mime_type: String(row.mime_type),
    file_size: Number(row.file_size),
    source: row.source as Slip["source"],
    parser_version: String(row.parser_version),
    qr_payload: row.qr_payload ? String(row.qr_payload) : null,
    extracted_json: (row.extracted_json as Slip["extracted_json"]) || null,
    raw_ocr_text: row.raw_ocr_text ? String(row.raw_ocr_text) : null,
    overall_confidence: row.overall_confidence !== null && row.overall_confidence !== undefined ? Number(row.overall_confidence) : null,
    status: row.status as Slip["status"],
    linked_transaction_id: row.linked_transaction_id ? String(row.linked_transaction_id) : null,
    duplicate_of_slip_id: row.duplicate_of_slip_id ? String(row.duplicate_of_slip_id) : null,
    created_at: String(row.created_at),
    processed_at: row.processed_at ? String(row.processed_at) : null,
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
  };
}

function mapSlipJob(row: Record<string, unknown>): SlipIngestionJob {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    slip_id: String(row.slip_id),
    status: row.status as SlipIngestionJob["status"],
    attempt_count: Number(row.attempt_count) || 1,
    processor_version: String(row.processor_version) || "v1",
    error_code: row.error_code ? String(row.error_code) : null,
    safe_error_message: row.safe_error_message ? String(row.safe_error_message) : null,
    started_at: String(row.started_at),
    finished_at: row.finished_at ? String(row.finished_at) : null,
    created_at: String(row.created_at),
  };
}

function mapSlipCorrection(row: Record<string, unknown>): SlipCorrection {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    slip_id: String(row.slip_id),
    field_name: String(row.field_name),
    extracted_value: row.extracted_value,
    corrected_value: row.corrected_value,
    created_at: String(row.created_at),
  };
}

function mapAccountMatchAlias(row: Record<string, unknown>): AccountMatchAlias {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    account_id: String(row.account_id),
    institution: row.institution ? String(row.institution) : null,
    raw_masked_pattern: row.raw_masked_pattern ? String(row.raw_masked_pattern) : null,
    normalized_masked_pattern: String(row.normalized_masked_pattern),
    source: String(row.source || "manual_confirm"),
    confirmed_count: Number(row.confirmed_count || 1),
    created_at: String(row.created_at || new Date().toISOString()),
    updated_at: String(row.updated_at || new Date().toISOString()),
  };
}

export class SupabaseDataStoreImpl implements IDataStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private clientOverride?: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(clientOverride?: any) {
    this.clientOverride = clientOverride;
  }

  /**
   * Resolves the appropriate Supabase client.
   * - In normal user flow: uses the user session client so RLS is enforced at DB level.
   * - In background / iOS ingest token flow: uses server admin client strictly on the server.
   */
  private async getClient(userId?: string, options?: { requireAdmin?: boolean }): Promise<SupabaseClient> {
    if (this.clientOverride) {
      return this.clientOverride;
    }

    if (options?.requireAdmin) {
      if (hasAdminCredentials()) {
        return createAdminClient();
      }
      return await createServerSupabaseClient();
    }

    const userClient = await createServerSupabaseClient();
    if (!userId) return userClient;

    // Fast path: Reuse request-scoped user verified via getAuthenticatedUser().
    // Since getAuthenticatedUser() is wrapped in React cache(), this costs 0 extra network calls!
    const authUser = await getAuthenticatedUser();
    if (authUser && authUser.id === userId) {
      return userClient;
    }

    // If no active user session cookie exists for this userId (e.g. iOS ingest token path),
    // use the minimum trusted server-side client with strict ownership scoping.
    if (hasAdminCredentials()) {
      return createAdminClient();
    }

    // Fallback if not pre-resolved in request scope (e.g. isolated test or script)
    try {
      const { data } = await withJwtSkewRetry(async () => {
        const res = await userClient.auth.getUser();
        if (res.error && isTransientJwtSkewError(res.error)) {
          throw res.error;
        }
        return res;
      });
      if (data?.user?.id === userId) {
        return userClient;
      }
    } catch {
      // ignore
    }

    return userClient;
  }

  /**
   * Executes a database query with automatic clock-skew resilience.
   * If a transient "JWT issued at future" error is encountered immediately after login,
   * retries up to 2 times with bounded delays (300ms, 700ms).
   * Unrelated errors fail immediately without retry.
   */
  private async executeRead<T extends { error: unknown }>(
    queryFn: () => PromiseLike<T>
  ): Promise<T> {
    return executeQueryWithSkewRetry(queryFn);
  }

  // ACCOUNTS
  async getAccounts(userId: string): Promise<Account[]> {
    assertUserId(userId);
    return getCachedAccounts(this, userId);
  }

  async fetchAccountsDirect(userId: string): Promise<Account[]> {
    assertUserId(userId);
    return measurePerf("data.accounts", async () => {
      const client = await this.getClient(userId);
      const { data, error } = await this.executeRead(() =>
        client
          .from("accounts")
          .select("*")
          .eq("user_id", userId)
          .eq("active", true)
          .order("created_at", { ascending: true })
      );

      if (error) {
        throw new Error(`Failed to fetch accounts: ${(error as Error).message}`);
      }
      return (data || []).map(mapAccount);
    }, (res) => res.length);
  }

  async getAllAccounts(userId: string): Promise<Account[]> {
    assertUserId(userId);
    return measurePerf("data.allAccounts", async () => {
      const client = await this.getClient(userId);
      const { data, error } = await this.executeRead(() =>
        client
          .from("accounts")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
      );

      if (error) {
        throw new Error(`Failed to fetch all accounts: ${(error as Error).message}`);
      }
      return (data || []).map(mapAccount);
    }, (res) => res.length);
  }

  async getAccountById(userId: string, id: string): Promise<Account | null> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const { data, error } = await this.executeRead(() =>
      client
        .from("accounts")
        .select("*")
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle()
    );

    if (error) {
      throw new Error(`Failed to fetch account by id: ${(error as Error).message}`);
    }
    return data ? mapAccount(data) : null;
  }

  async createAccount(
    userId: string,
    data: AccountInput | AccountFormData
  ): Promise<Account> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const payload = {
      user_id: userId,
      name: data.name,
      institution: data.institution || null,
      type: data.type,
      masked_number: data.masked_number || null,
      opening_balance: Number(data.opening_balance) || 0,
      currency: data.currency || "THB",
      active: data.active ?? true,
    };

    const { data: created, error } = await client
      .from("accounts")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create account: ${error.message}`);
    }
    return mapAccount(created);
  }

  async updateAccount(
    userId: string,
    id: string,
    data: Partial<AccountFormData>
  ): Promise<Account> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.institution !== undefined) updatePayload.institution = data.institution;
    if (data.type !== undefined) updatePayload.type = data.type;
    if (data.masked_number !== undefined) updatePayload.masked_number = data.masked_number;
    if (data.opening_balance !== undefined) updatePayload.opening_balance = Number(data.opening_balance);
    if (data.active !== undefined) updatePayload.active = data.active;

    const { data: updated, error } = await client
      .from("accounts")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw new Error("Account not found or access denied");
    }
    return mapAccount(updated);
  }

  async archiveAccount(userId: string, id: string): Promise<void> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const { error } = await client
      .from("accounts")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      throw new Error("Account not found or access denied");
    }
  }

  // CATEGORIES
  async getCategories(userId: string): Promise<Category[]> {
    assertUserId(userId);
    return getCachedCategories(this, userId);
  }

  async fetchCategoriesDirect(userId: string): Promise<Category[]> {
    assertUserId(userId);
    return measurePerf("data.categories", async () => {
      const client = await this.getClient(userId);
      const { data, error } = await this.executeRead(() =>
        client
          .from("categories")
          .select("*")
          .or(`user_id.eq.${userId},is_system.eq.true`)
          .order("name", { ascending: true })
      );

      if (error) {
        throw new Error(`Failed to fetch categories: ${(error as Error).message}`);
      }
      return (data || []).map(mapCategory);
    }, (res) => res.length);
  }

  async createCategory(
    userId: string,
    data: CategoryFormData
  ): Promise<Category> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const payload = {
      user_id: userId,
      name: data.name,
      type: data.type,
      icon: data.icon || null,
      color: data.color || null,
      is_system: false,
    };

    const { data: created, error } = await client
      .from("categories")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create category: ${error.message}`);
    }
    return mapCategory(created);
  }

  // PEOPLE
  async getPeople(userId: string): Promise<Person[]> {
    assertUserId(userId);
    return getCachedPeople(this, userId);
  }

  async fetchPeopleDirect(userId: string): Promise<Person[]> {
    assertUserId(userId);
    return measurePerf("data.people", async () => {
      const client = await this.getClient(userId);
      const { data, error } = await this.executeRead(() =>
        client
          .from("people")
          .select("*")
          .eq("user_id", userId)
          .order("display_name", { ascending: true })
      );

      if (error) {
        throw new Error(`Failed to fetch people: ${(error as Error).message}`);
      }
      return (data || []).map(mapPerson);
    }, (res) => res.length);
  }

  async getPersonById(userId: string, id: string): Promise<Person | null> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const { data, error } = await this.executeRead(() =>
      client
        .from("people")
        .select("*")
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle()
    );

    if (error) {
      throw new Error(`Failed to fetch person by id: ${(error as Error).message}`);
    }
    return data ? mapPerson(data) : null;
  }

  async createPerson(userId: string, data: PersonFormData): Promise<Person> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const payload = {
      user_id: userId,
      display_name: data.display_name,
      normalized_name: data.display_name.trim().toLowerCase(),
      aliases: data.aliases || [],
      phone: data.phone || null,
      note: data.note || null,
    };

    const { data: created, error } = await client
      .from("people")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create person: ${error.message}`);
    }
    return mapPerson(created);
  }

  async updatePerson(
    userId: string,
    id: string,
    data: Partial<PersonFormData>
  ): Promise<Person> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.display_name !== undefined) {
      updatePayload.display_name = data.display_name;
      updatePayload.normalized_name = data.display_name.trim().toLowerCase();
    }
    if (data.aliases !== undefined) updatePayload.aliases = data.aliases;
    if (data.phone !== undefined) updatePayload.phone = data.phone;
    if (data.note !== undefined) updatePayload.note = data.note;

    const { data: updated, error } = await client
      .from("people")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw new Error("Person not found or access denied");
    }
    return mapPerson(updated);
  }

  // MERCHANTS
  async getMerchants(userId: string): Promise<Merchant[]> {
    assertUserId(userId);
    return getCachedMerchants(this, userId);
  }

  async fetchMerchantsDirect(userId: string): Promise<Merchant[]> {
    assertUserId(userId);
    return measurePerf("data.merchants", async () => {
      const client = await this.getClient(userId);
      const { data, error } = await this.executeRead(() =>
        client
          .from("merchants")
          .select("*")
          .eq("user_id", userId)
          .order("display_name", { ascending: true })
      );

      if (error) {
        throw new Error(`Failed to fetch merchants: ${(error as Error).message}`);
      }
      return (data || []).map(mapMerchant);
    }, (res) => res.length);
  }

  async getMerchantById(userId: string, id: string): Promise<Merchant | null> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const { data, error } = await this.executeRead(() =>
      client
        .from("merchants")
        .select("*")
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle()
    );

    if (error) {
      throw new Error(`Failed to fetch merchant by id: ${(error as Error).message}`);
    }
    return data ? mapMerchant(data) : null;
  }

  async createMerchant(
    userId: string,
    data: MerchantFormData
  ): Promise<Merchant> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const payload = {
      user_id: userId,
      display_name: data.display_name,
      normalized_name: data.display_name.trim().toLowerCase(),
      category_hint: data.category_hint || null,
      aliases: data.aliases || [],
      metadata: {},
    };

    const { data: created, error } = await client
      .from("merchants")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create merchant: ${error.message}`);
    }
    return mapMerchant(created);
  }

  async updateMerchant(
    userId: string,
    id: string,
    data: Partial<MerchantFormData>
  ): Promise<Merchant> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.display_name !== undefined) {
      updatePayload.display_name = data.display_name;
      updatePayload.normalized_name = data.display_name.trim().toLowerCase();
    }
    if (data.category_hint !== undefined) updatePayload.category_hint = data.category_hint;
    if (data.aliases !== undefined) updatePayload.aliases = data.aliases;

    const { data: updated, error } = await client
      .from("merchants")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw new Error("Merchant not found or access denied");
    }
    return mapMerchant(updated);
  }

  // TRANSACTIONS
  async getTransactions(
    userId: string,
    preloadedRelations?: PreloadedRelations
  ): Promise<TransactionWithRelations[]> {
    assertUserId(userId);
    return measurePerf("data.transactions", async () => {
      const client = await this.getClient(userId);

      const accountsPromise = preloadedRelations?.accounts
        ? Promise.resolve(preloadedRelations.accounts)
        : this.getAccounts(userId);
      const categoriesPromise = preloadedRelations?.categories
        ? Promise.resolve(preloadedRelations.categories)
        : this.getCategories(userId);
      const peoplePromise = preloadedRelations?.people
        ? Promise.resolve(preloadedRelations.people)
        : this.getPeople(userId);
      const merchantsPromise = preloadedRelations?.merchants
        ? Promise.resolve(preloadedRelations.merchants)
        : this.getMerchants(userId);

      const [txsRes, accounts, categories, people, merchants] = await Promise.all([
        this.executeRead(() =>
          client
            .from("transactions")
            .select("*")
            .eq("user_id", userId)
            .order("transaction_date", { ascending: false })
        ),
        accountsPromise,
        categoriesPromise,
        peoplePromise,
        merchantsPromise,
      ]);

      if (txsRes.error) {
        throw new Error(`Failed to fetch transactions: ${(txsRes.error as Error).message}`);
      }

      const txs = (txsRes.data || []).map(mapTransaction);

      return txs.map((tx) => ({
        ...tx,
        from_account: tx.from_account_id
          ? accounts.find((a) => a.id === tx.from_account_id) || null
          : null,
        to_account: tx.to_account_id
          ? accounts.find((a) => a.id === tx.to_account_id) || null
          : null,
        category: tx.category_id
          ? categories.find((c) => c.id === tx.category_id) || null
          : null,
        person: tx.person_id
          ? people.find((p) => p.id === tx.person_id) || null
          : null,
        merchant: tx.merchant_id
          ? merchants.find((m) => m.id === tx.merchant_id) || null
          : null,
      }));
    }, (res) => res.length);
  }

  async getTransactionsPageData(userId: string): Promise<TransactionsPageData> {
    assertUserId(userId);
    return measurePerf("data.getTransactionsPageData", async () => {
      const client = await this.getClient(userId);

      const [accounts, categories, people, merchants, txsRes] = await Promise.all([
        this.getAccounts(userId),
        this.getCategories(userId),
        this.getPeople(userId),
        this.getMerchants(userId),
        this.executeRead(() =>
          client
            .from("transactions")
            .select("*")
            .eq("user_id", userId)
            .order("transaction_date", { ascending: false })
        ),
      ]);

      if (txsRes.error) {
        throw new Error(`Failed to fetch transactions page data: ${(txsRes.error as Error).message}`);
      }

      const txs = (txsRes.data || []).map(mapTransaction);
      const transactions = txs.map((tx) => ({
        ...tx,
        from_account: tx.from_account_id
          ? accounts.find((a) => a.id === tx.from_account_id) || null
          : null,
        to_account: tx.to_account_id
          ? accounts.find((a) => a.id === tx.to_account_id) || null
          : null,
        category: tx.category_id
          ? categories.find((c) => c.id === tx.category_id) || null
          : null,
        person: tx.person_id
          ? people.find((p) => p.id === tx.person_id) || null
          : null,
        merchant: tx.merchant_id
          ? merchants.find((m) => m.id === tx.merchant_id) || null
          : null,
      }));

      return {
        transactions,
        accounts,
        categories,
        people,
        merchants,
      };
    }, (res) => res.transactions.length);
  }

  async getTransactionById(
    userId: string,
    id: string,
    preloadedRelations?: PreloadedRelations
  ): Promise<TransactionWithRelations | null> {
    assertUserId(userId);
    return measurePerf("data.getTransactionById", async () => {
      const client = await this.getClient(userId);

      const accountsPromise = preloadedRelations?.accounts
        ? Promise.resolve(preloadedRelations.accounts)
        : this.getAccounts(userId);
      const categoriesPromise = preloadedRelations?.categories
        ? Promise.resolve(preloadedRelations.categories)
        : this.getCategories(userId);
      const peoplePromise = preloadedRelations?.people
        ? Promise.resolve(preloadedRelations.people)
        : this.getPeople(userId);
      const merchantsPromise = preloadedRelations?.merchants
        ? Promise.resolve(preloadedRelations.merchants)
        : this.getMerchants(userId);

      const [txRes, accounts, categories, people, merchants] = await Promise.all([
        this.executeRead(() =>
          client
            .from("transactions")
            .select("*")
            .eq("user_id", userId)
            .eq("id", id)
            .maybeSingle()
        ),
        accountsPromise,
        categoriesPromise,
        peoplePromise,
        merchantsPromise,
      ]);

      if (txRes.error) {
        throw new Error(`Failed to fetch transaction by id: ${(txRes.error as Error).message}`);
      }
      if (!txRes.data) return null;

      const tx = mapTransaction(txRes.data);
      return {
        ...tx,
        from_account: tx.from_account_id
          ? accounts.find((a) => a.id === tx.from_account_id) || null
          : null,
        to_account: tx.to_account_id
          ? accounts.find((a) => a.id === tx.to_account_id) || null
          : null,
        category: tx.category_id
          ? categories.find((c) => c.id === tx.category_id) || null
          : null,
        person: tx.person_id
          ? people.find((p) => p.id === tx.person_id) || null
          : null,
        merchant: tx.merchant_id
          ? merchants.find((m) => m.id === tx.merchant_id) || null
          : null,
      };
    });
  }

  async createTransaction(
    userId: string,
    data: TransactionInput | TransactionFormData
  ): Promise<Transaction> {
    assertUserId(userId);
    const client = await this.getClient(userId);

    // Idempotency: if transaction for this source_slip_id was already created, return it
    if (data.source_slip_id) {
      const { data: existing } = await client
        .from("transactions")
        .select()
        .eq("user_id", userId)
        .eq("source_slip_id", data.source_slip_id)
        .maybeSingle();

      if (existing) {
        return mapTransaction(existing);
      }
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

    // Verify foreign keys belong to user
    if (data.from_account_id) {
      const acc = await this.getAccountById(userId, data.from_account_id);
      if (!acc) throw new Error("Invalid source account: access denied or account does not exist");
    }
    if (data.to_account_id) {
      const acc = await this.getAccountById(userId, data.to_account_id);
      if (!acc) throw new Error("Invalid destination account: access denied or account does not exist");
    }
    if (data.category_id) {
      const categories = await this.getCategories(userId);
      const exists = categories.some((c) => c.id === data.category_id);
      if (!exists) throw new Error("Invalid category: access denied or category does not exist");
    }
    if (data.person_id) {
      const person = await this.getPersonById(userId, data.person_id);
      if (!person) throw new Error("Invalid counterparty person: access denied or person does not exist");
    }
    if (data.merchant_id) {
      const merchant = await this.getMerchantById(userId, data.merchant_id);
      if (!merchant) throw new Error("Invalid merchant: access denied or merchant does not exist");
    }

    const payload = {
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
    };

    const { data: created, error } = await client
      .from("transactions")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create transaction: ${error.message}`);
    }
    return mapTransaction(created);
  }

  async updateTransaction(
    userId: string,
    id: string,
    data: Partial<TransactionFormData>
  ): Promise<Transaction> {
    assertUserId(userId);
    const client = await this.getClient(userId);

    // Get current transaction
    const current = await this.getTransactionById(userId, id);
    if (!current) {
      throw new Error("Transaction not found or access denied");
    }

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
      const acc = await this.getAccountById(userId, fromId);
      if (!acc) throw new Error("Invalid source account: access denied or account does not exist");
    }
    if (toId) {
      const acc = await this.getAccountById(userId, toId);
      if (!acc) throw new Error("Invalid destination account: access denied or account does not exist");
    }
    if (categoryId) {
      const categories = await this.getCategories(userId);
      const exists = categories.some((c) => c.id === categoryId);
      if (!exists) throw new Error("Invalid category: access denied or category does not exist");
    }
    if (personId) {
      const person = await this.getPersonById(userId, personId);
      if (!person) throw new Error("Invalid counterparty person: access denied or person does not exist");
    }
    if (merchantId) {
      const merchant = await this.getMerchantById(userId, merchantId);
      if (!merchant) throw new Error("Invalid merchant: access denied or merchant does not exist");
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

    const updatePayload: Record<string, unknown> = {
      type,
      amount: finalAmount,
      currency: data.currency || current.currency,
      transaction_date: data.transaction_date || current.transaction_date,
      description: data.description !== undefined ? data.description : current.description,
      note: data.note !== undefined ? data.note : current.note,
      from_account_id: fromId,
      to_account_id: toId,
      person_id: personId,
      merchant_id: merchantId,
      category_id: categoryId,
      payment_method: data.payment_method !== undefined ? data.payment_method : current.payment_method,
      tax_income_type: data.tax_income_type !== undefined ? data.tax_income_type : current.tax_income_type,
      tax_deductible: data.tax_deductible !== undefined ? data.tax_deductible : current.tax_deductible,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error } = await client
      .from("transactions")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw new Error("Transaction not found or access denied");
    }
    return mapTransaction(updated);
  }

  async deleteTransaction(userId: string, id: string): Promise<void> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const { error } = await client
      .from("transactions")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      throw new Error("Transaction not found or access denied");
    }
  }

  // INGEST TOKENS
  async getIngestTokens(userId: string): Promise<IngestToken[]> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const { data, error } = await client
      .from("ingest_tokens")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch ingest tokens: ${error.message}`);
    }
    return (data || []).map(mapIngestToken);
  }

  async createIngestToken(
    userId: string,
    data: { label: string; scope?: string; expires_at?: string | null }
  ): Promise<{ rawToken: string; record: IngestToken }> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const { rawToken, tokenHash, tokenPrefix } = generateIngestToken();

    const payload = {
      user_id: userId,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      label: data.label || "iPhone 11 Pro Max",
      scope: data.scope || "slip:ingest",
      expires_at: data.expires_at || null,
      metadata: {},
    };

    const { data: record, error } = await client
      .from("ingest_tokens")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create ingest token: ${error.message}`);
    }

    return { rawToken, record: mapIngestToken(record) };
  }

  async verifyAndConsumeIngestToken(rawToken: string): Promise<IngestToken | null> {
    if (!rawToken || typeof rawToken !== "string") return null;
    const tokenHash = hashToken(rawToken);

    // Minimum trusted server-side client to verify ingest token
    const client = await this.getClient(undefined, { requireAdmin: true });
    const { data: tokens, error } = await client
      .from("ingest_tokens")
      .select("*")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null);

    if (error || !tokens || tokens.length === 0) {
      return null;
    }

    const token = mapIngestToken(tokens[0]);
    if (!isTokenUsable(token)) {
      return null;
    }

    if (!verifyTokenHash(rawToken, token.token_hash)) {
      return null;
    }

    // Update last_used_at
    await client
      .from("ingest_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", token.id);

    token.last_used_at = new Date().toISOString();
    return token;
  }

  async revokeIngestToken(userId: string, tokenId: string): Promise<void> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const { error } = await client
      .from("ingest_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", tokenId)
      .eq("user_id", userId);

    if (error) {
      throw new Error("Token not found or access denied");
    }
  }

  // SLIPS
  async getSlips(userId: string): Promise<Slip[]> {
    assertUserId(userId);
    return measurePerf("data.slips", async () => {
      const client = await this.getClient(userId);
      const { data, error } = await this.executeRead(() =>
        client
          .from("slips")
          .select("*")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
      );

      if (error) {
        throw new Error(`Failed to fetch slips: ${(error as Error).message}`);
      }
      return (data || []).map(mapSlip);
    }, (res) => res.length);
  }

  async getSlipById(userId: string, id: string): Promise<Slip | null> {
    assertUserId(userId);
    return measurePerf("data.getSlipById", async () => {
      const client = await this.getClient(userId);
      const { data, error } = await this.executeRead(() =>
        client
          .from("slips")
          .select("*")
          .eq("user_id", userId)
          .eq("id", id)
          .is("deleted_at", null)
          .maybeSingle()
      );

      if (error) {
        throw new Error(`Failed to fetch slip by id: ${(error as Error).message}`);
      }
      return data ? mapSlip(data) : null;
    });
  }

  async getSlipByIdUnscoped(id: string): Promise<Slip | null> {
    if (!id) return null;
    const client = await this.getClient(undefined, { requireAdmin: true });
    const { data, error } = await client
      .from("slips")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !data) return null;
    return mapSlip(data);
  }

  async getSlipByFileHash(userId: string, hash: string): Promise<Slip | null> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const { data, error } = await client
      .from("slips")
      .select("*")
      .eq("user_id", userId)
      .eq("file_hash_sha256", hash)
      .is("deleted_at", null)
      .neq("status", "rejected")
      .neq("status", "duplicate")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch slip by hash: ${error.message}`);
    }
    return data ? mapSlip(data) : null;
  }

  async getPendingReviewSlips(userId: string): Promise<Slip[]> {
    assertUserId(userId);
    return measurePerf("data.slips.pendingReview", async () => {
      const client = await this.getClient(userId);
      const { data, error } = await this.executeRead(() =>
        client
          .from("slips")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "needs_review")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
      );

      if (error) {
        throw new Error(`Failed to fetch pending review slips: ${(error as Error).message}`);
      }
      return (data || []).map(mapSlip);
    }, (res) => res.length);
  }

  async createSlip(userId: string, data: Partial<Slip>): Promise<Slip> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const payload = {
      ...(data.id ? { id: data.id } : {}),
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
    };

    const { data: created, error } = await client
      .from("slips")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create slip: ${error.message}`);
    }
    return mapSlip(created);
  }

  async updateSlip(
    userId: string,
    id: string,
    data: Partial<Slip>
  ): Promise<Slip> {
    assertUserId(userId);
    const client = await this.getClient(userId);

    // Validate linked transaction ownership
    if (data.linked_transaction_id) {
      const tx = await this.getTransactionById(userId, data.linked_transaction_id);
      if (!tx) {
        throw new Error("Security violation: linked transaction must belong to the slip owner");
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.storage_path !== undefined) updatePayload.storage_path = data.storage_path;
    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.qr_payload !== undefined) updatePayload.qr_payload = data.qr_payload;
    if (data.extracted_json !== undefined) updatePayload.extracted_json = data.extracted_json;
    if (data.raw_ocr_text !== undefined) updatePayload.raw_ocr_text = data.raw_ocr_text;
    if (data.overall_confidence !== undefined) updatePayload.overall_confidence = data.overall_confidence;
    if (data.linked_transaction_id !== undefined) updatePayload.linked_transaction_id = data.linked_transaction_id;
    if (data.duplicate_of_slip_id !== undefined) updatePayload.duplicate_of_slip_id = data.duplicate_of_slip_id;
    if (data.processed_at !== undefined) updatePayload.processed_at = data.processed_at;
    if (data.deleted_at !== undefined) updatePayload.deleted_at = data.deleted_at;

    const { data: updated, error } = await client
      .from("slips")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw new Error("Slip not found or access denied");
    }
    return mapSlip(updated);
  }

  // SLIP JOBS
  async createSlipJob(
    userId: string,
    data: Partial<SlipIngestionJob>
  ): Promise<SlipIngestionJob> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const payload = {
      ...(data.id ? { id: data.id } : {}),
      user_id: userId,
      slip_id: data.slip_id || "",
      status: data.status || "processing",
      attempt_count: data.attempt_count || 1,
      processor_version: data.processor_version || "v1",
      error_code: data.error_code || null,
      safe_error_message: data.safe_error_message || null,
      finished_at: data.finished_at || null,
    };

    const { data: created, error } = await client
      .from("slip_ingestion_jobs")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create slip job: ${error.message}`);
    }
    return mapSlipJob(created);
  }

  async updateSlipJob(
    userId: string,
    id: string,
    data: Partial<SlipIngestionJob>
  ): Promise<SlipIngestionJob> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const updatePayload: Record<string, unknown> = {};

    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.attempt_count !== undefined) updatePayload.attempt_count = data.attempt_count;
    if (data.error_code !== undefined) updatePayload.error_code = data.error_code;
    if (data.safe_error_message !== undefined) updatePayload.safe_error_message = data.safe_error_message;
    if (data.finished_at !== undefined) updatePayload.finished_at = data.finished_at;

    const { data: updated, error } = await client
      .from("slip_ingestion_jobs")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw new Error("Slip job not found or access denied");
    }
    return mapSlipJob(updated);
  }

  async getSlipJobById(
    userId: string,
    id: string
  ): Promise<SlipIngestionJob | null> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const { data, error } = await client
      .from("slip_ingestion_jobs")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch slip job: ${error.message}`);
    }
    return data ? mapSlipJob(data) : null;
  }

  // SLIP CORRECTIONS
  async createSlipCorrection(
    userId: string,
    data: Partial<SlipCorrection>
  ): Promise<SlipCorrection> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const payload = {
      user_id: userId,
      slip_id: data.slip_id || "",
      field_name: data.field_name || "",
      extracted_value: data.extracted_value,
      corrected_value: data.corrected_value,
    };

    const { data: created, error } = await client
      .from("slip_corrections")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create slip correction: ${error.message}`);
    }
    return mapSlipCorrection(created);
  }

  async getSlipCorrections(
    userId: string,
    slipId?: string
  ): Promise<SlipCorrection[]> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    let query = client
      .from("slip_corrections")
      .select("*")
      .eq("user_id", userId);

    if (slipId) {
      query = query.eq("slip_id", slipId);
    }

    const { data, error } = await this.executeRead(() => query);
    if (error) {
      throw new Error(`Failed to fetch slip corrections: ${(error as Error).message}`);
    }
    return (data || []).map(mapSlipCorrection);
  }

  // ACCOUNT MATCH ALIASES
  async getAccountMatchAliases(userId: string): Promise<AccountMatchAlias[]> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const { data, error } = await this.executeRead(() =>
      client
        .from("account_match_aliases")
        .select("*")
        .eq("user_id", userId)
    );
    if (error) {
      return [];
    }
    return (data || []).map(mapAccountMatchAlias);
  }

  async recordAccountMatchAlias(
    userId: string,
    data: {
      account_id: string;
      institution?: string | null;
      raw_masked_pattern?: string | null;
      normalized_masked_pattern: string;
      source?: string;
    }
  ): Promise<AccountMatchAlias> {
    assertUserId(userId);
    const client = await this.getClient(userId);
    const normBank = data.institution ? normalizeBankName(data.institution) : null;
    const payload = {
      user_id: userId,
      account_id: data.account_id,
      institution: normBank,
      raw_masked_pattern: data.raw_masked_pattern || null,
      normalized_masked_pattern: data.normalized_masked_pattern,
      source: data.source || "manual_confirm",
    };

    const { data: upserted, error } = await client
      .from("account_match_aliases")
      .upsert(payload, {
        onConflict: "user_id, account_id, institution, normalized_masked_pattern",
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to record account match alias: ${error.message}`);
    }
    return mapAccountMatchAlias(upserted);
  }

  async backfillAccountMatchAliases(
    userId: string
  ): Promise<{ created: number; skipped: number }> {
    assertUserId(userId);
    let created = 0;
    let skipped = 0;

    const verifiedTxs = await this.getTransactions(userId);
    const filteredTxs = verifiedTxs.filter(
      (t) =>
        Boolean(t.source_slip_id) &&
        (t.review_status === "confirmed" || t.review_status === "corrected")
    );

    for (const tx of filteredTxs) {
      const slip = await this.getSlipById(userId, tx.source_slip_id!);
      if (!slip || !slip.extracted_json) continue;

      if (tx.from_account_id && slip.extracted_json.sender?.accountMasked) {
        try {
          const rawMask = slip.extracted_json.sender.accountMasked;
          const pattern = normalizeMaskedPattern(rawMask);
          const bank = normalizeBankName(slip.extracted_json.sender.bank);
          await this.recordAccountMatchAlias(userId, {
            account_id: tx.from_account_id,
            institution: bank,
            raw_masked_pattern: rawMask,
            normalized_masked_pattern: pattern,
            source: "backfill",
          });
          created++;
        } catch {
          skipped++;
        }
      }

      if (tx.to_account_id && slip.extracted_json.receiver?.accountMasked) {
        try {
          const rawMask = slip.extracted_json.receiver.accountMasked;
          const pattern = normalizeMaskedPattern(rawMask);
          const bank = normalizeBankName(slip.extracted_json.receiver.bank);
          await this.recordAccountMatchAlias(userId, {
            account_id: tx.to_account_id,
            institution: bank,
            raw_masked_pattern: rawMask,
            normalized_masked_pattern: pattern,
            source: "backfill",
          });
          created++;
        } catch {
          skipped++;
        }
      }
    }

    return { created, skipped };
  }

  // PRIVATE STORAGE (Supabase Storage bucket: 'slips')
  async saveSlipFile(storagePath: string, buffer: Buffer): Promise<void> {
    const parts = storagePath.split("/");
    const userId = parts[0];
    const client = await this.getClient(userId);
    const mimeType = detectMimeFromPath(storagePath);

    const { error } = await client.storage
      .from("slips")
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload slip to Supabase storage: ${error.message}`);
    }
  }

  async getSlipFile(storagePath: string): Promise<Buffer | null> {
    const parts = storagePath.split("/");
    const userId = parts[0];
    const client = await this.getClient(userId, { requireAdmin: true });

    const { data, error } = await client.storage
      .from("slips")
      .download(storagePath);

    if (error || !data) {
      return null;
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

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
  }

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
  }

  // Atomic Slip Confirmation
  async confirmSlipTransaction(
    userId: string,
    input: ConfirmSlipTransactionInput
  ): Promise<ConfirmSlipTransactionResult> {
    assertUserId(userId);
    const client = await this.getClient(userId);

    // Call the atomic PostgreSQL RPC. In production Supabase mode, the RPC is mandatory.
    // If the RPC fails or is unavailable, fail closed! Never emulate atomicity with multiple network requests.
    const { data: rpcRes, error: rpcError } = await client.rpc(
      "confirm_slip_transaction",
      {
        p_slip_id: input.slipId,
        p_user_id: userId,
        p_tx_type: input.type,
        p_amount: Number(input.amount),
        p_currency: input.currency || "THB",
        p_transaction_date: input.transaction_date,
        p_description: input.description || null,
        p_note: input.note || null,
        p_from_account_id: input.from_account_id || null,
        p_to_account_id: input.to_account_id || null,
        p_category_id: input.category_id || null,
        p_merchant_id: input.merchant_id || null,
        p_person_id: input.person_id || null,
        p_reference_number: input.reference_number || null,
        p_confidence: input.confidence !== undefined ? input.confidence : 1.0,
        p_review_status: input.review_status || "confirmed",
      }
    );

    if (rpcError) {
      const errMsg = rpcError.message || "";
      if (
        errMsg.includes("could not find function") ||
        errMsg.includes("does not exist") ||
        errMsg.includes("schema cache")
      ) {
        throw new Error("ระบบยืนยันรายการยังไม่พร้อม กรุณาติดต่อผู้ดูแล");
      }
      throw new Error(errMsg);
    }

    if (!rpcRes || !rpcRes.transaction_id) {
      throw new Error("ระบบยืนยันรายการยังไม่พร้อม กรุณาติดต่อผู้ดูแล");
    }

    const tx = await this.getTransactionById(userId, rpcRes.transaction_id);
    if (!tx) {
      throw new Error("Failed to retrieve confirmed transaction");
    }

    return {
      transaction: tx,
      alreadyConfirmed: Boolean(rpcRes.already_confirmed),
    };
  }

  reset(): void {
    // SupabaseDataStore does not allow arbitrary database resets
    throw new Error("DataStore.reset() is not supported on SupabaseDataStore.");
  }
}

export const SupabaseDataStore = new SupabaseDataStoreImpl();
