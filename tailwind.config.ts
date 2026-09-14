import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "var(--bg)",
          subtle: "var(--bg-subtle)",
        },
        surface: {
          DEFAULT: "var(--surface)",
          raised: "var(--surface-raised)",
          soft: "var(--surface-soft)",
          muted: "var(--surface-muted)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          hover: "var(--primary-hover)",
          soft: "var(--primary-soft)",
          foreground: "var(--primary-foreground)",
        },
        income: {
          DEFAULT: "var(--income)",
          soft: "var(--income-soft)",
        },
        expense: {
          DEFAULT: "var(--expense)",
          soft: "var(--expense-soft)",
        },
        transfer: {
          DEFAULT: "var(--transfer)",
          soft: "var(--transfer-soft)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          soft: "var(--warning-soft)",
        },
        finance: {
          income: "var(--income)",
          expense: "var(--expense)",
          transfer: "var(--transfer)",
          muted: "var(--text-muted)",
        },
        // Compatibility with shadcn / HSL tokens
        input: "var(--border)",
        ring: "var(--primary)",
        background: "var(--bg)",
        foreground: "var(--text-primary)",
        secondary: {
          DEFAULT: "var(--surface-soft)",
          foreground: "var(--text-primary)",
        },
        muted: {
          DEFAULT: "var(--surface-soft)",
          foreground: "var(--text-muted)",
        },
        accent: {
          DEFAULT: "var(--surface-soft)",
          foreground: "var(--text-primary)",
        },
        card: {
          DEFAULT: "var(--surface)",
          foreground: "var(--text-primary)",
        },
      },
      boxShadow: {
        "2xs": "0 1px 2px 0 rgba(0, 0, 0, 0.03)",
        xs: "var(--shadow-sm)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      backgroundImage: {
        "hero-gradient": "var(--gradient-hero)",
        "accent-gradient": "var(--gradient-accent)",
      },
      fontFamily: {
        sans: [
          "Geist",
          "Noto Sans Thai",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        sm: "8px",
        md: "10px",
        lg: "12px",
        xl: "14px",
        "2xl": "16px",
      },
    },
  },
  plugins: [],
};

export default config;
