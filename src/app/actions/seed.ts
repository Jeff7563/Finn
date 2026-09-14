"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { ActionResult } from "./auth";

export async function seedSampleDataAction(): Promise<ActionResult> {
  try {
    const user = await requireUser();

    // 1. Create accounts
    const scb = await DataStore.createAccount(user.id, {
      name: "SCB Main Payroll",
      institution: "SCB",
      type: "bank",
      masked_number: "4321",
      opening_balance: 15000,
      currency: "THB",
      active: true,
    });

    const kbank = await DataStore.createAccount(user.id, {
      name: "KBank Savings",
      institution: "KBANK",
      type: "bank",
      masked_number: "8765",
      opening_balance: 5000,
      currency: "THB",
      active: true,
    });

    const cash = await DataStore.createAccount(user.id, {
      name: "Cash Wallet",
      type: "cash",
      opening_balance: 1200,
      currency: "THB",
      active: true,
    });

    // 2. Create People & Merchants
    const somchai = await DataStore.createPerson(user.id, {
      display_name: "Somchai Jaidee",
      aliases: ["สมชาย", "Somchai J"],
      phone: "081-999-1234",
      note: "Colleague / lunch repayments",
    });

    const sevenEleven = await DataStore.createMerchant(user.id, {
      display_name: "7-Eleven",
      category_hint: "Food",
      aliases: ["เซเว่น", "CP ALL"],
    });

    const lotus = await DataStore.createMerchant(user.id, {
      display_name: "Lotus's Supermarket",
      category_hint: "Food",
      aliases: ["โลตัส"],
    });

    // Find Categories
    const categories = await DataStore.getCategories(user.id);
    const catSalary = categories.find((c) => c.name === "Salary");
    const catFood = categories.find((c) => c.name === "Food");

    // 3. Create realistic sample transactions
    const now = new Date();
    const d = (daysAgo: number) => {
      const date = new Date(now);
      date.setDate(date.getDate() - daysAgo);
      return date.toISOString();
    };

    // Salary Income
    await DataStore.createTransaction(user.id, {
      type: "income",
      amount: 45000,
      to_account_id: scb.id,
      category_id: catSalary?.id,
      transaction_date: d(7),
      description: "Monthly Tech Salary",
      source: "manual",
      tax_deductible: false,
    });

    // Transfer between own accounts (SCB -> KBank 10,000)
    await DataStore.createTransaction(user.id, {
      type: "transfer",
      amount: 10000,
      from_account_id: scb.id,
      to_account_id: kbank.id,
      transaction_date: d(5),
      description: "Monthly Savings Allocation",
      source: "manual",
      tax_deductible: false,
    });

    // Transfer between own accounts (SCB -> Cash 1,000)
    await DataStore.createTransaction(user.id, {
      type: "transfer",
      amount: 1000,
      from_account_id: scb.id,
      to_account_id: cash.id,
      transaction_date: d(4),
      description: "ATM Cash Withdrawal",
      source: "manual",
      tax_deductible: false,
    });

    // Expense at Lotus's
    await DataStore.createTransaction(user.id, {
      type: "expense",
      amount: 850,
      from_account_id: scb.id,
      merchant_id: lotus.id,
      category_id: catFood?.id,
      transaction_date: d(3),
      description: "Weekly Groceries",
      source: "manual",
      tax_deductible: false,
    });

    // Expense at 7-Eleven
    await DataStore.createTransaction(user.id, {
      type: "expense",
      amount: 125,
      from_account_id: cash.id,
      merchant_id: sevenEleven.id,
      category_id: catFood?.id,
      transaction_date: d(2),
      description: "Morning coffee & snacks",
      source: "manual",
      tax_deductible: false,
    });

    // Income from Somchai (loan repayment)
    await DataStore.createTransaction(user.id, {
      type: "income",
      amount: 500,
      to_account_id: scb.id,
      person_id: somchai.id,
      transaction_date: d(1),
      description: "Lunch reimbursement from Somchai",
      source: "manual",
      tax_deductible: false,
    });

    revalidatePath("/today");
    revalidatePath("/overview");
    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/people");
    revalidatePath("/merchants");

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to seed sample data";
    return { success: false, error: message };
  }
}
