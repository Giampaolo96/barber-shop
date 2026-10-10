import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { it } from "@/i18n/it";
import { getShopInfo } from "@/lib/booking/queries";
import { splitShopName } from "@/lib/shop/name";
import { appIdentity, fontVariables } from "@/themes/active";
import "./globals.css";

/** Titolo dal nome del negozio nelle impostazioni (it.shop.name è solo il segnaposto). */
export async function generateMetadata(): Promise<Metadata> {
  const shop = await getShopInfo();
  const name = shop?.name ?? it.shop.name;
  return {
    title: name,
    description: it.meta.description,
    // App installata su iOS: nome breve sotto l'icona; barra di stato chiara, sopra la pagina.
    appleWebApp: { capable: true, title: splitShopName(name).lead || name, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: appIdentity.themeColor,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it" className={`${fontVariables} h-full font-sans antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
