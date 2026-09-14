import { z } from "zod";

export const MAX_MONEY_AMOUNT = 999_999_999_999.99;
export const MIN_MONEY_AMOUNT = -999_999_999_999.99;

export const accountSchema = z.object({
  name: z.string().trim().min(1, "Account name is required").max(100),
  institution: z.string().trim().max(100).optional().nullable(),
  type: z.enum(["bank", "cash", "e_wallet", "credit_card", "investment", "other"]),
  masked_number: z.string().trim().max(20).optional().nullable(),
  opening_balance: z.coerce
    .number()
    .refine((v) => Number.isFinite(v), "Opening balance must be a valid finite number")
    .refine((v) => v >= MIN_MONEY_AMOUNT && v <= MAX_MONEY_AMOUNT, "Opening balance is out of acceptable bounds")
    .default(0),
  currency: z.string().trim().default("THB"),
  active: z.boolean().default(true),
});

export type AccountInput = z.input<typeof accountSchema>;
export type AccountFormData = z.infer<typeof accountSchema>;

export const transactionSchema = z
  .object({
    type: z.enum([
      "income",
      "expense",
      "transfer",
      "refund",
      "reimbursement",
      "loan_received",
      "loan_payment",
      "gift",
      "investment",
      "adjustment",
    ]),
    amount: z.coerce
      .number()
      .refine((v) => Number.isFinite(v), "Amount must be a valid finite number")
      .refine((v) => v > 0, "Amount must be greater than 0")
      .refine((v) => v <= MAX_MONEY_AMOUNT, "Amount exceeds maximum allowable limit"),
    currency: z.string().trim().default("THB"),
    transaction_date: z.string().min(1, "Date and time are required"),
    description: z.string().trim().max(255).optional().nullable(),
    note: z.string().trim().max(1000).optional().nullable(),
    from_account_id: z.string().trim().min(1).optional().nullable(),
    to_account_id: z.string().trim().min(1).optional().nullable(),
    person_id: z.string().trim().min(1).optional().nullable(),
    merchant_id: z.string().trim().min(1).optional().nullable(),
    category_id: z.string().trim().min(1).optional().nullable(),
    payment_method: z.string().trim().max(50).optional().nullable(),
    source: z.enum(["manual", "slip", "import", "shortcut"]).default("manual"),
    source_slip_id: z.string().trim().optional().nullable(),
    reference_number: z.string().trim().max(100).optional().nullable(),
    tax_income_type: z.string().optional().nullable(),
    tax_deductible: z.boolean().default(false),
    tax_year: z.coerce.number().optional().nullable(),
    confidence: z.coerce.number().optional(),
    review_status: z.enum(["pending", "confirmed", "corrected", "rejected"]).optional(),
  })
  .refine(
    (data) => {
      if (data.type === "transfer") {
        return (
          Boolean(data.from_account_id) &&
          Boolean(data.to_account_id) &&
          data.from_account_id !== data.to_account_id
        );
      }
      return true;
    },
    {
      message: "Transfer requires different source and destination accounts",
      path: ["to_account_id"],
    }
  );

export type TransactionInput = z.input<typeof transactionSchema>;
export type TransactionFormData = z.infer<typeof transactionSchema>;

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required").max(100),
  type: z.enum(["income", "expense"]),
  icon: z.string().trim().max(50).optional().nullable(),
  color: z.string().trim().max(50).optional().nullable(),
});

export type CategoryInput = z.input<typeof categorySchema>;
export type CategoryFormData = z.infer<typeof categorySchema>;

export const personSchema = z.object({
  display_name: z.string().trim().min(1, "Name is required").max(100),
  aliases: z.array(z.string().trim()).default([]),
  phone: z.string().trim().max(30).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export type PersonInput = z.input<typeof personSchema>;
export type PersonFormData = z.infer<typeof personSchema>;

export const merchantSchema = z.object({
  display_name: z.string().trim().min(1, "Merchant name is required").max(100),
  category_hint: z.string().trim().max(100).optional().nullable(),
  aliases: z.array(z.string().trim()).default([]),
});

export type MerchantInput = z.input<typeof merchantSchema>;
export type MerchantFormData = z.infer<typeof merchantSchema>;

export const authSchema = z.object({
  email: z.string().trim().email("Invalid email address").max(255),
  password: z.string().min(6, "Password must be at least 6 characters").max(128),
});

export type AuthFormData = z.infer<typeof authSchema>;
