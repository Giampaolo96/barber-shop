import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { it } from "@/i18n/it";
import { getShopInfo } from "@/lib/booking/queries";
import { fontVariables } from "@/themes/active";
import "./globals.css";

/** Titolo dal nome del negozio nelle impostazioni (it.shop.name è solo il segnaposto). */
export async function generateMetadata(): Promise<Metadata> {
  const shop = await getShopInfo();
  return { title: shop?.name ?? it.shop.name, description: it.meta.description };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it" className={`${fontVariables} h-full font-sans antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
