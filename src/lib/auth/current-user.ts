import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/db/server";
import {
  ADMIN_PATH,
  CUSTOMER_LOGIN_PATH,
  DISABLED_REASON,
  HOME_PATH,
  STAFF_LOGIN_PATH,
  isStaffRole,
} from "./access";
import type { Role } from "./access";
import { ACCESS_PROFILE_COLUMNS, toCurrentUser } from "./profile";
import type { CurrentUser } from "./profile";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Utente della sessione di questo client. L'identità è verificata con getUser() e il ruolo
 * viene solo dalla tabella profiles: senza profilo non c'è alcun ruolo.
 */
export async function loadCurrentUser(supabase: ServerClient): Promise<CurrentUser | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(ACCESS_PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return null;

  return toCurrentUser(user.id, profile);
}

/** Utente della richiesta corrente (una sola lettura per rendering). */
export const getCurrentUser = cache(
  async (): Promise<CurrentUser | null> => loadCurrentUser(await createClient()),
);

/** Da chiamare in layout, pagine e server action: respinge con un redirect chi non ha il ruolo. */
export async function requireRole(allowed: readonly Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  const staffOnly = allowed.every((role) => isStaffRole(role));

  if (!user) redirect(staffOnly ? STAFF_LOGIN_PATH : CUSTOMER_LOGIN_PATH);
  if (isStaffRole(user.role) && user.isBlocked) {
    redirect(STAFF_LOGIN_PATH + "?motivo=" + DISABLED_REASON);
  }
  if (!allowed.includes(user.role)) redirect(isStaffRole(user.role) ? ADMIN_PATH : HOME_PATH);

  return user;
}
