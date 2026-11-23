import type { Role } from "./access";

export type CurrentUser = {
  id: string;
  role: Role;
  isBlocked: boolean;
  profileComplete: boolean;
  /** Consenso privacy a una versione non più corrente: niente nuove prenotazioni (fetta 9b). */
  privacyConsentOutdated?: boolean;
};

/** Colonne di profiles che servono a decidere l'accesso. */
export const ACCESS_PROFILE_COLUMNS =
  "role, is_blocked, full_name, phone, privacy_consent_at, privacy_consent_outdated";

export type AccessProfileRow = {
  role: Role;
  is_blocked: boolean;
  full_name: string | null;
  phone: string | null;
  privacy_consent_at: string | null;
  /** Campo calcolato PostgREST (funzione public.privacy_consent_outdated). */
  privacy_consent_outdated?: boolean | null;
};

const filled = (value: string | null): boolean => (value ?? "").trim() !== "";

/** Profilo completo (SPEC §5.5, §8): nome, telefono e consenso privacy. */
export function toCurrentUser(id: string, row: AccessProfileRow): CurrentUser {
  return {
    id,
    role: row.role,
    isBlocked: row.is_blocked,
    profileComplete: filled(row.full_name) && filled(row.phone) && row.privacy_consent_at !== null,
    privacyConsentOutdated: row.privacy_consent_outdated === true,
  };
}
