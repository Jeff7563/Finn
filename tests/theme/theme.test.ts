import { describe, it, expect } from "vitest";
import {
  parseThemeMode,
  resolveTheme,
  THEME_STORAGE_KEY,
  themeInitScript,
} from "@/components/theme/ThemeProvider";

describe("Theme System Unit Tests", () => {
  it("defines standard storage key as finn-theme", () => {
    expect(THEME_STORAGE_KEY).toBe("finn-theme");
  });

  describe("parseThemeMode", () => {
    it("parses valid theme modes correctly", () => {
      expect(parseThemeMode("system")).toBe("system");
      expect(parseThemeMode("light")).toBe("light");
      expect(parseThemeMode("dark")).toBe("dark");
    });

    it("defaults invalid or unknown values to system", () => {
      expect(parseThemeMode(null)).toBe("system");
      expect(parseThemeMode(undefined)).toBe("system");
      expect(parseThemeMode("")).toBe("system");
      expect(parseThemeMode("sepia")).toBe("system");
      expect(parseThemeMode(123)).toBe("system");
      expect(parseThemeMode({})).toBe("system");
    });
  });

  describe("resolveTheme", () => {
    it("resolves explicit light mode as light regardless of system preference", () => {
      expect(resolveTheme("light", "light")).toBe("light");
      expect(resolveTheme("light", "dark")).toBe("light");
    });

    it("resolves explicit dark mode as dark regardless of system preference", () => {
      expect(resolveTheme("dark", "light")).toBe("dark");
      expect(resolveTheme("dark", "dark")).toBe("dark");
    });

    it("resolves system mode to the system preference", () => {
      expect(resolveTheme("system", "light")).toBe("light");
      expect(resolveTheme("system", "dark")).toBe("dark");
    });
  });

  describe("themeInitScript", () => {
    it("contains localStorage key reference and FOUC prevention logic", () => {
      expect(themeInitScript).toContain("finn-theme");
      expect(themeInitScript).toContain("prefers-color-scheme: dark");
      expect(themeInitScript).toContain("document.documentElement");
      expect(themeInitScript).toContain('data-theme');
      expect(themeInitScript).toContain('classList.add("dark")');
      expect(themeInitScript).toContain('classList.remove("dark")');
    });
  });
});
