import type { MetadataRoute } from "next";
import { it } from "@/i18n/it";
import { getShopInfo } from "@/lib/booking/queries";
import { appIconPath } from "@/lib/pwa/icons";
import { splitShopName } from "@/lib/shop/name";
import { appIdentity } from "@/themes/active";

// Pubblico e senza dati personali (ADR 009): solo il nome del negozio dalle impostazioni.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const shop = await getShopInfo();
  const name = shop?.name ?? it.shop.name;

  return {
    name,
    short_name: splitShopName(name).lead || name,
    description: it.meta.description,
    lang: "it",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: appIdentity.themeColor,
    background_color: appIdentity.backgroundColor,
    icons: [
      { src: appIconPath(192), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: appIconPath(512), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: appIconPath(512), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
