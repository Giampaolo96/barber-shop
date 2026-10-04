import { decideAccess, type AccessInput } from "./access";

// Destinazione dopo il login: solo percorsi relativi interni, per non fare da open redirect.

const BASE = "http://internal.invalid";

/** Oltre questa lunghezza la destinazione si scarta (si torna alla home). */
export const NEXT_MAX_LENGTH = 2048;

export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.length > NEXT_MAX_LENGTH) return "/";
  // `//host` e `/\host` sono URL esterni per il browser; spazi e caratteri di controllo
  // vengono rimossi dal parser degli URL e possono nasconderli.
  if (next.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(next)) return "/";

  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE || url.pathname.startsWith("//")) return "/";
  } catch {
    return "/";
  }
  return next;
}

// Ritorno dopo il magic link: la destinazione viaggia nell'URL di redirect di Supabase
// (`{{ .RedirectTo }}` nel template), codificata in base64url perché arrivi intatta dentro la
// query di /auth/confirm. Se Supabase non accetta il redirect usa il SiteURL: si torna alla home.
const RETURN_PARAM = "n";

/** URL di redirect per signInWithOtp che porta con sé `next` (già validato). */
export function emailRedirectUrl(origin: string, next: string): string {
  return `${origin}/?${RETURN_PARAM}=${Buffer.from(next, "utf8").toString("base64url")}`;
}

/**
 * Destinazione grezza dal parametro `next` di /auth/confirm: un percorso relativo così com'è,
 * oppure quella codificata nell'URL di redirect. Il risultato va sempre validato con safeNextPath.
 */
export function nextFromEmailLink(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value === "") return null;
  if (value.startsWith("/")) return value;
  try {
    const encoded = new URL(value).searchParams.get(RETURN_PARAM);
    return encoded ? Buffer.from(encoded, "base64url").toString("utf8") : null;
  } catch {
    return null;
  }
}

/** `/profilo/completa` con la destinazione da raggiungere dopo il salvataggio. */
export function completeProfileUrl(path: string, next: string): string {
  return next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`;
}

/**
 * Dove mandare l'utente dopo login o completamento del profilo: `next` (già passato da
 * safeNextPath) se può aprirlo, altrimenti dove dice decideAccess. Senza destinazione valida si
 * torna alla home.
 */
export function destinationAfterLogin(next: string, user: Omit<AccessInput, "path">): string {
  const path = new URL(next, BASE).pathname;
  const decision = decideAccess({ path, ...user });
  return decision.type === "redirect" ? decision.to : next;
}
