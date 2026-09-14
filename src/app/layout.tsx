import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finn — Personal Finance OS",
  description:
    "Deterministic personal financial system for tracking income, expenses, accounts, and counterparties.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased selection:bg-slate-200">
        {children}
      </body>
    </html>
  );
}
