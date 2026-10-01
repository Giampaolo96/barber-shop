import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { it } from "@/i18n/it";
import "./globals.css";

export const metadata: Metadata = {
  title: it.shop.name,
  description: it.meta.description,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it" className="h-full font-sans antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
