import { z } from "zod";

export const accountSchema = z.object({
  name: z.string().min(1, "Account name is required").max(100),
  institution: z.string().max(100).optional().nullable(),
  type: z.enum(["bank", "cash", "e_wallet", "credit_card", "investment", "other"]),
  masked_number: z.string().max(20).optional().nullable(),
  opening_balance: z.coerce.number().default(0),
  currency: z.string().default("THB"),
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
    amount: z.coerce.number().positive("Amount must be greater than 0"),
    currency: z.string().default("THB"),
    transaction_date: z.string().min(1, "Date and time are required"),
    description: z.string().max(255).optional().nullable(),
    note: z.string().max(1000).optional().nullable(),
    from_account_id: z.string().uuid("Please select an account").optional().nullable(),
    to_account_id: z.string().uuid("Please select an account").optional().nullable(),
    person_id: z.string().uuid().optional().nullable(),
    merchant_id: z.string().uuid().optional().nullable(),
    category_id: z.string().uuid().optional().nullable(),
    payment_method: z.string().max(50).optional().nullable(),
    source: z.enum(["manual", "slip", "import", "shortcut"]).default("manual"),
    reference_number: z.string().max(100).optional().nullable(),
    tax_income_type: z.string().optional().nullable(),
    tax_deductible: z.boolean().default(false),
    tax_year: z.coerce.number().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.type === "transfer") {
        return (
          data.from_account_id &&
          data.to_account_id &&
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
  name: z.string().min(1, "Category name is required").max(100),
  type: z.enum(["income", "expense"]),
  icon: z.string().max(50).optional().nullable(),
  color: z.string().max(50).optional().nullable(),
});

export type CategoryInput = z.input<typeof categorySchema>;
export type CategoryFormData = z.infer<typeof categorySchema>;

export const personSchema = z.object({
  display_name: z.string().min(1, "Name is required").max(100),
  aliases: z.array(z.string()).default([]),
  phone: z.string().max(30).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

export type PersonInput = z.input<typeof personSchema>;
export type PersonFormData = z.infer<typeof personSchema>;

export const merchantSchema = z.object({
  display_name: z.string().min(1, "Merchant name is required").max(100),
  category_hint: z.string().max(100).optional().nullable(),
  aliases: z.array(z.string()).default([]),
});

export type MerchantInput = z.input<typeof merchantSchema>;
export type MerchantFormData = z.infer<typeof merchantSchema>;

export const authSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type AuthFormData = z.infer<typeof authSchema>;
