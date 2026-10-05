// Ripiego per il template email predefinito di Supabase (finché manca l'SMTP con il template
// personalizzato, docs/DEPLOY.md): il link passa da /auth/v1/verify e torna all'URL di redirect
// (home o /auth/confirm) con ?code= oppure con i parametri d'errore. Logica pura per il proxy.
import { CUSTOMER_LOGIN_PATH } from "./access";
import { nextFromEmailLink, safeNextPath } from "./safe-next-path";

export const EMAIL_CALLBACK_PATH = "/auth/callback";
export const INVALID_LINK_PATH = `${CUSTOMER_LOGIN_PATH}?errore=link`;

/** Percorsi su cui Supabase può rimandare: Site URL e URL di redirect del magic link. */
const LANDING_PATHS = new Set(["/", "/auth/confirm"]);

/**
 * Dove mandare una richiesta che arriva dal link predefinito, o null se non ne arriva. Un errore
 * (link scaduto o già usato) vince sul code; il code passa a /auth/callback con tutti i parametri
 * (anche `n`, la destinazione codificata).
 */
export function emailLinkFallback(url: URL): string | null {
  if (!LANDING_PATHS.has(url.pathname)) return null;
  const params = url.searchParams;
  if (params.has("error") || params.has("error_code")) return INVALID_LINK_PATH;
  if (params.has("code")) return `${EMAIL_CALLBACK_PATH}${url.search}`;
  return null;
}

/**
 * Destinazione dopo lo scambio in /auth/callback, già validata. Il code può arrivare dalla home
 * (`?n=` nella query) o da /auth/confirm (`?next=<redirect con n>`, come il flusso principale):
 * vale `next` se c'è, altrimenti `n`. Sempre un percorso interno (safeNextPath).
 */
export function callbackDestination(url: URL): string {
  return safeNextPath(nextFromEmailLink(url.searchParams.get("next")) ?? nextFromEmailLink(url.href));
}

