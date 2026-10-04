import "server-only";

// Controlli comuni alle pagine del flusso di prenotazione: ogni pagina chiama requireRole
// (CLAUDE.md – Sicurezza), poi legge impostazioni del negozio e stato di blocco del cliente.
import { notFound, redirect } from "next/navigation";
import { COMPLETE_PROFILE_PATH } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/current-user";
import type { CurrentUser } from "@/lib/auth/profile";
import { getBookingProfile, getShopInfo, type ShopInfo } from "./queries";
import { isBlockedForBooking } from "./rules";

export type BookingPageContext = { user: CurrentUser; shop: ShopInfo; blocked: boolean };

export async function loadBookingPageContext(): Promise<BookingPageContext> {
  const user = await requireRole(["customer"]);
  if (!user.profileComplete) redirect(COMPLETE_PROFILE_PATH);

  const [shop, profile] = await Promise.all([getShopInfo(), getBookingProfile(user.id)]);
  if (!shop) notFound();
  const blocked =
    profile === null || isBlockedForBooking(profile, shop.noShowBlockThreshold);
  return { user, shop, blocked };
}
