import "server-only";

// Controlli comuni alle pagine del flusso di prenotazione: ogni pagina chiama requireRole
// (CLAUDE.md – Sicurezza), poi legge impostazioni del negozio e stato di blocco del cliente.
import { notFound, redirect } from "next/navigation";
import { COMPLETE_PROFILE_PATH } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/current-user";
import type { CurrentUser } from "@/lib/auth/profile";
import { getBookingProfile, getShopInfo, type ShopInfo } from "./queries";
import { isBlockedForBooking } from "./rules";

/**
 * `access`: "ok" può prenotare; "blocked" bloccato (manualmente o per no-show); "error" non è
 * stato possibile leggere il profilo (si invita a riprovare, non si mostra il blocco).
 */
export type BookingPageContext = {
  user: CurrentUser;
  shop: ShopInfo;
  access: "ok" | "blocked" | "error";
};

export async function loadBookingPageContext(): Promise<BookingPageContext> {
  const user = await requireRole(["customer"]);
  if (!user.profileComplete) redirect(COMPLETE_PROFILE_PATH);

  const [shop, profile] = await Promise.all([getShopInfo(), getBookingProfile(user.id)]);
  if (!shop) notFound();

  let access: BookingPageContext["access"] = "ok";
  if (!profile.ok) access = "error";
  // Profilo assente: non dovrebbe accadere dopo requireRole; per prudenza niente prenotazione.
  else if (!profile.profile || isBlockedForBooking(profile.profile, shop.noShowBlockThreshold)) {
    access = "blocked";
  }
  return { user, shop, access };
}
