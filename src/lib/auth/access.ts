// Regole di accesso alle aree dell'app: logica pura, senza I/O. Il ruolo arriva sempre
// dalla tabella profiles (mai dai metadati del JWT); proxy e layout applicano la decisione.

export type Role = "customer" | "barber" | "admin";

export type AccessInput = {
  path: string;
  /** `null` = anonimo */
  role: Role | null;
  isBlocked: boolean;
  profileComplete: boolean;
};

export type AccessDecision = { type: "allow" } | { type: "redirect"; to: string };

export const HOME_PATH = "/";
export const CUSTOMER_LOGIN_PATH = "/accedi";
export const COMPLETE_PROFILE_PATH = "/profilo/completa";
export const ADMIN_PATH = "/admin";
export const STAFF_LOGIN_PATH = "/admin/login";
/** Valore di `?motivo=` con cui il login dello staff mostra "Account disabilitato". */
export const DISABLED_REASON = "disabilitato";

/** Rotte aperte a tutto lo staff oltre a /admin; ogni altra rotta di /admin è solo per l'admin. */
const STAFF_CALENDAR_PATH = "/admin/calendario";
/** Assenze del barbiere collegato all'utente (SPEC §2: "gestisce le proprie assenze"). */
export const OWN_TIME_OFF_PATH = "/admin/assenze";

/** Pagine private del cliente: richiedono login e profilo completo. */
const CUSTOMER_PRIVATE_PREFIXES = ["/prenota", "/prenotazioni", "/profilo"];

const ALLOW: AccessDecision = { type: "allow" };
const redirectTo = (to: string): AccessDecision => ({ type: "redirect", to });

const isUnder = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

const normalize = (path: string): string => {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
};

export const isStaffRole = (role: Role | null): role is "barber" | "admin" =>
  role === "barber" || role === "admin";

export function decideAccess(input: AccessInput): AccessDecision {
  const path = normalize(input.path);
  const { role, isBlocked, profileComplete } = input;

  const isStaffLogin = path === STAFF_LOGIN_PATH;
  const isAdminArea = isUnder(path, ADMIN_PATH) && !isStaffLogin;
  const isCompleteProfile = path === COMPLETE_PROFILE_PATH;
  const isCustomerPrivate =
    !isCompleteProfile && CUSTOMER_PRIVATE_PREFIXES.some((prefix) => isUnder(path, prefix));

  if (role === null) {
    if (isAdminArea) return redirectTo(STAFF_LOGIN_PATH);
    if (isCompleteProfile || isCustomerPrivate) return redirectTo(CUSTOMER_LOGIN_PATH);
    return ALLOW;
  }

  if (isStaffRole(role)) {
    // Lo staff bloccato non entra in /admin; la pagina di login resta raggiungibile.
    if (isBlocked) return isAdminArea ? redirectTo(STAFF_LOGIN_PATH) : ALLOW;

    if (isStaffLogin || path === CUSTOMER_LOGIN_PATH || isCompleteProfile || isCustomerPrivate) {
      return redirectTo(ADMIN_PATH);
    }
    const isStaffPath =
      path === ADMIN_PATH || isUnder(path, STAFF_CALENDAR_PATH) || isUnder(path, OWN_TIME_OFF_PATH);
    if (isAdminArea && role === "barber" && !isStaffPath) return redirectTo(ADMIN_PATH);
    return ALLOW;
  }

  // Cliente: il blocco riguarda solo la prenotazione online, non l'accesso.
  if (isAdminArea || isStaffLogin) return redirectTo(HOME_PATH);
  if (path === CUSTOMER_LOGIN_PATH) {
    return redirectTo(profileComplete ? HOME_PATH : COMPLETE_PROFILE_PATH);
  }
  if (isCompleteProfile) return profileComplete ? redirectTo(HOME_PATH) : ALLOW;
  if (isCustomerPrivate && !profileComplete) return redirectTo(COMPLETE_PROFILE_PATH);
  return ALLOW;
}
