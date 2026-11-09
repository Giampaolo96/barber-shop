import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/db/server";
import { getClaimsCached } from "./jwks";
import {
  ADMIN_PATH,
  CUSTOMER_LOGIN_PATH,
  DISABLED_REASON,
  HOME_PATH,
  PASSWORD_REQUIRED_REASON,
  STAFF_LOGIN_PATH,
  isPasswordSession,
  isStaffRole,
} from "./access";
import type { Role } from "./access";
import { ACCESS_PROFILE_COLUMNS, toCurrentUser } from "./profile";
import type { CurrentUser } from "./profile";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Colonne del profilo della sessione: quelle dell'accesso più i no-show (blocco della prenotazione). */
const SESSION_PROFILE_COLUMNS = `${ACCESS_PROFILE_COLUMNS}, no_show_count` as const;

type SessionProfile = { user: CurrentUser; noShowCount: number };

async function loadProfile(supabase: ServerClient, userId: string): Promise<SessionProfile | null> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(SESSION_PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) console.error("loadProfile", error);
  if (!profile) return null;
  return { user: toCurrentUser(userId, profile), noShowCount: profile.no_show_count };
}

/**
 * Utente della sessione di questo client. L'identità è verificata con getUser() e il ruolo
 * viene solo dalla tabella profiles: senza profilo non c'è alcun ruolo.
 */
export async function loadCurrentUser(supabase: ServerClient): Promise<CurrentUser | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return (await loadProfile(supabase, user.id))?.user ?? null;
}

/**
 * Id dell'utente verificato con getUser() (una sola verifica per rendering). Non decide l'accesso:
 * serve solo ad avviare le letture del cliente insieme al profilo, dopo c'è sempre requireRole.
 */
export const getVerifiedUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
});

/** Profilo della sessione, letto una volta per rendering (ruolo, accesso e no-show). */
const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const userId = await getVerifiedUserId();
  if (!userId) return null;
  return loadProfile(await createClient(), userId);
});

/** Utente della richiesta corrente (una sola lettura per rendering). */
export const getCurrentUser = cache(
  async (): Promise<CurrentUser | null> => (await getSessionProfile())?.user ?? null,
);

/** No-show dell'utente della richiesta, dalla stessa lettura del profilo; null senza profilo. */
export async function getCurrentNoShowCount(): Promise<number | null> {
  return (await getSessionProfile())?.noShowCount ?? null;
}

/** Sessione della richiesta aperta con password (claim amr); false se i claim non si leggono. */
const hasPasswordSession = cache(async (): Promise<boolean> => {
  return isPasswordSession(await getClaimsCached(await createClient()));
});

/** Da chiamare in layout, pagine e server action: respinge con un redirect chi non ha il ruolo. */
export async function requireRole(allowed: readonly Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  const staffOnly = allowed.every((role) => isStaffRole(role));

  if (!user) redirect(staffOnly ? STAFF_LOGIN_PATH : CUSTOMER_LOGIN_PATH);
  if (isStaffRole(user.role) && user.isBlocked) {
    redirect(STAFF_LOGIN_PATH + "?motivo=" + DISABLED_REASON);
  }
  // Staff entrato senza password (ADR 015): nel database non ha privilegi, qui nessun accesso.
  if (isStaffRole(user.role) && !(await hasPasswordSession())) {
    redirect(STAFF_LOGIN_PATH + "?motivo=" + PASSWORD_REQUIRED_REASON);
  }
  if (!allowed.includes(user.role)) redirect(isStaffRole(user.role) ? ADMIN_PATH : HOME_PATH);

  return user;
}
