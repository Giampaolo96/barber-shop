// Sessione revocata ma ancora nei cookie (ADR 002): getClaims() nel proxy verifica il JWT in
// locale e non si accorge di una sessione chiusa altrove (logout dall'app installata, revoca), mentre
// le pagine con getUser() vedono un anonimo. Prima di un redirect dovuto all'utente loggato il proxy
// conferma la sessione con Supabase; se non esiste più, cancella i cookie e decide come anonimo.
// Logica pura: l'I/O (getUser, cookie) sta nel proxy.
import { type AccessDecision, decideAccess } from "./access";
import type { CurrentUser } from "./profile";

/** Esito della conferma con Supabase: "unknown" se la verifica non ha risposto (rete, 5xx). */
export type SessionCheck = "valid" | "gone" | "unknown";

export type ResolvedAccess = {
  decision: AccessDecision;
  user: CurrentUser | null;
  /** La sessione dei cookie non esiste più: il proxy deve cancellare i cookie di autenticazione. */
  clearAuthCookies: boolean;
};

const decide = (path: string, user: CurrentUser | null): AccessDecision =>
  decideAccess({
    path,
    role: user?.role ?? null,
    isBlocked: user?.isBlocked ?? false,
    profileComplete: user?.profileComplete ?? false,
  });

/**
 * Decisione del proxy. `confirmSession` (getUser) si chiama solo quando c'è un utente e la
 * decisione è un redirect: le richieste consentite non pagano la chiamata in più. Se la conferma
 * non risponde vale la decisione di partenza: un errore di rete non chiude la sessione.
 */
export async function resolveAccess(
  path: string,
  user: CurrentUser | null,
  confirmSession: () => Promise<SessionCheck>,
): Promise<ResolvedAccess> {
  const decision = decide(path, user);
  if (!user || decision.type === "allow") return { decision, user, clearAuthCookies: false };

  if ((await confirmSession()) !== "gone") return { decision, user, clearAuthCookies: false };
  return { decision: decide(path, null), user: null, clearAuthCookies: true };
}

/**
 * Errori di getUser() che dicono che la sessione (o l'utente) non esiste più. Con una sessione
 * revocata supabase-js toglie la sessione dal client e restituisce AuthSessionMissingError
 * (status 400, senza codice) invece del session_not_found di Supabase.
 */
export function sessionIsGone(error: { status?: number; code?: string; name?: string } | null): boolean {
  if (!error) return false;
  if (error.name === "AuthSessionMissingError") return true;
  if (error.code === "session_not_found" || error.code === "user_not_found" || error.code === "bad_jwt") return true;
  return error.status === 401 || error.status === 403;
}

/** Cookie della sessione Supabase (anche a pezzi: .0, .1…), senza il code verifier del PKCE. */
export const isAuthTokenCookie = (name: string): boolean =>
  name.startsWith("sb-") && /-auth-token(?:\.\d+)?$/.test(name);
