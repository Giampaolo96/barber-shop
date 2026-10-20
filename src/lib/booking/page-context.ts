import "server-only";

// Controlli comuni alle pagine del flusso di prenotazione: ogni pagina chiama requireRole
// (CLAUDE.md – Sicurezza), poi legge impostazioni del negozio e stato di blocco del cliente.
import { notFound, redirect } from "next/navigation";
import { COMPLETE_PROFILE_PATH } from "@/lib/auth/access";
import { getCurrentNoShowCount, requireRole } from "@/lib/auth/current-user";
import type { CurrentUser } from "@/lib/auth/profile";
import { getShopInfo, type ShopInfo } from "./queries";
import { isBlockedForBooking } from "./rules";

/** `access`: "ok" può prenotare; "blocked" bloccato (manualmente o per no-show). */
export type BookingPageContext = {
  user: CurrentUser;
  shop: ShopInfo;
  access: "ok" | "blocked";
};

export async function loadBookingPageContext(): Promise<BookingPageContext> {
  const user = await requireRole(["customer"]);
  if (!user.profileComplete) redirect(COMPLETE_PROFILE_PATH);

  // Blocco e no-show arrivano dalla stessa lettura del profilo di requireRole (nessuna query in più).
  const [shop, noShowCount] = await Promise.all([getShopInfo(), getCurrentNoShowCount()]);
  if (!shop) notFound();

  // Profilo assente: non dovrebbe accadere dopo requireRole; per prudenza niente prenotazione.
  const blocked =
    noShowCount === null ||
    isBlockedForBooking({ isBlocked: user.isBlocked, noShowCount }, shop.noShowBlockThreshold);
  return { user, shop, access: blocked ? "blocked" : "ok" };
}
