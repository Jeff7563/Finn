import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SYSTEM_CATEGORY_THAI_MAP,
  getSystemCategoryThaiName,
  getCategoryDisplayName,
  getCategoryLabelPair,
} from "@/lib/finance/category-labels";
import { CategoriesClient } from "@/components/categories/CategoriesClient";
import { MemoryDataStore } from "@/lib/server/memory-data-store";
import { DataStore } from "@/lib/server/data-store";
import { Category } from "@/types/finance";

describe("FINN — Thai System Category Labels & Presentation Localization", () => {
  const testUserId = "user-cat-labels-test-1111-111111111111";

  beforeEach(() => {
    MemoryDataStore.reset();
  });

  // 1. Helper translations
  describe("Category localization helpers", () => {
    it("maps Food to อาหาร", () => {
      expect(getSystemCategoryThaiName("Food")).toBe("อาหาร");
    });

    it("maps Salary to เงินเดือน", () => {
      expect(getSystemCategoryThaiName("Salary")).toBe("เงินเดือน");
    });

    it("maps Investment Income to รายได้จากการลงทุน", () => {
      expect(getSystemCategoryThaiName("Investment Income")).toBe("รายได้จากการลงทุน");
    });

    it("maps Business Expense to ค่าใช้จ่ายธุรกิจ", () => {
      expect(getSystemCategoryThaiName("Business Expense")).toBe("ค่าใช้จ่ายธุรกิจ");
    });

    it("safely falls back to original name for unknown system categories", () => {
      const unknownSystemName = "Crypto Staking Yield";
      expect(getSystemCategoryThaiName(unknownSystemName)).toBe("Crypto Staking Yield");
    });

    it("handles empty or null gracefully", () => {
      expect(getSystemCategoryThaiName(null)).toBe("");
      expect(getSystemCategoryThaiName(undefined)).toBe("");
      expect(getSystemCategoryThaiName("")).toBe("");
    });
  });

  // 2. getCategoryDisplayName
  describe("getCategoryDisplayName", () => {
    it("returns Thai translation for system category", () => {
      const foodCategory: Category = {
        id: "cat-food",
        user_id: null,
        name: "Food",
        type: "expense",
        icon: "food",
        color: "#f00",
        is_system: true,
        created_at: "",
        updated_at: "",
      };
      expect(getCategoryDisplayName(foodCategory)).toBe("อาหาร");
    });

    it("preserves custom user category in Thai unchanged", () => {
      const customThai: Category = {
        id: "cat-custom-1",
        user_id: testUserId,
        name: "กาแฟและเบเกอรี่",
        type: "expense",
        icon: "coffee",
        color: "#8B4513",
        is_system: false,
        created_at: "",
        updated_at: "",
      };
      expect(getCategoryDisplayName(customThai)).toBe("กาแฟและเบเกอรี่");
    });

    it("preserves custom user category in English unchanged", () => {
      const customEnglish: Category = {
        id: "cat-custom-2",
        user_id: testUserId,
        name: "Consulting Side Project",
        type: "income",
        icon: "briefcase",
        color: "#00f",
        is_system: false,
        created_at: "",
        updated_at: "",
      };
      expect(getCategoryDisplayName(customEnglish)).toBe("Consulting Side Project");
    });

    it("falls back to original name for unknown system category", () => {
      const unknownSysCat: Category = {
        id: "cat-unknown",
        user_id: null,
        name: "SaaS Royalties",
        type: "income",
        icon: "cloud",
        color: "#0f0",
        is_system: true,
        created_at: "",
        updated_at: "",
      };
      expect(getCategoryDisplayName(unknownSysCat)).toBe("SaaS Royalties");
    });
  });

  // 3. getCategoryLabelPair
  describe("getCategoryLabelPair", () => {
    it("returns Thai primary and English secondary for system category", () => {
      const cat: Category = {
        id: "cat-transport",
        user_id: null,
        name: "Transport",
        type: "expense",
        icon: "car",
        color: "#000",
        is_system: true,
        created_at: "",
        updated_at: "",
      };
      const pair = getCategoryLabelPair(cat);
      expect(pair.primary).toBe("ค่าเดินทาง");
      expect(pair.secondary).toBe("Transport");
    });

    it("returns custom category name as primary and null as secondary", () => {
      const custom: Category = {
        id: "cat-custom-3",
        user_id: testUserId,
        name: "ค่าตัดหญ้า",
        type: "expense",
        icon: "scissors",
        color: "#0f0",
        is_system: false,
        created_at: "",
        updated_at: "",
      };
      const pair = getCategoryLabelPair(custom);
      expect(pair.primary).toBe("ค่าตัดหญ้า");
      expect(pair.secondary).toBeNull();
    });
  });

  // 4. CategoriesClient UI rendering
  describe("CategoriesClient UI rendering", () => {
    it("renders Thai primary label and English secondary label for system categories, and badge for custom", () => {
      const initialCategories: Category[] = [
        {
          id: "cat-food",
          user_id: null,
          name: "Food",
          type: "expense",
          icon: "food",
          color: "#f00",
          is_system: true,
          created_at: "",
          updated_at: "",
        },
        {
          id: "cat-salary",
          user_id: null,
          name: "Salary",
          type: "income",
          icon: "wallet",
          color: "#0f0",
          is_system: true,
          created_at: "",
          updated_at: "",
        },
        {
          id: "cat-custom-th",
          user_id: testUserId,
          name: "ค่าซ่อมคอม",
          type: "expense",
          icon: "tool",
          color: "#888",
          is_system: false,
          created_at: "",
          updated_at: "",
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(CategoriesClient, { initialCategories })
      );

      // System category primary + secondary
      expect(html).toContain("อาหาร");
      expect(html).toContain("Food");

      // Custom category
      expect(html).toContain("ค่าซ่อมคอม");
      expect(html).toContain("กำหนดเอง");
    });
  });

  // 5. Database immutability
  describe("Database category immutability", () => {
    it("ensures canonical English names in database are untouched by presentation logic", async () => {
      const storedCategories = await DataStore.getCategories(testUserId);
      const foodInDb = storedCategories.find((c) => c.name === "Food");
      expect(foodInDb).toBeDefined();
      expect(foodInDb?.is_system).toBe(true);
      expect(foodInDb?.name).toBe("Food");

      // Running display name function does NOT mutate stored category
      const displayed = getCategoryDisplayName(foodInDb);
      expect(displayed).toBe("อาหาร");
      expect(foodInDb?.name).toBe("Food");

      // Verify store still has "Food"
      const refreshedCategories = await DataStore.getCategories(testUserId);
      const refreshedFood = refreshedCategories.find((c) => c.id === foodInDb?.id);
      expect(refreshedFood?.name).toBe("Food");
    });
  });
});
