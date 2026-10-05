import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { COMPLETE_PROFILE_PATH, STAFF_LOGIN_PATH, isStaffRole } from "@/lib/auth/access";
import { loadCurrentUser } from "@/lib/auth/current-user";
import { INVALID_LINK_PATH } from "@/lib/auth/email-fallback";
import {
  completeProfileUrl,
  destinationAfterLogin,
  nextFromEmailLink,
  safeNextPath,
} from "@/lib/auth/safe-next-path";
import type { Database } from "@/lib/db/database";
import { supabaseEnv } from "@/lib/db/env";

type CookieToSet = { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] };

/**
 * Ripiego per il link del template email predefinito di Supabase (flusso PKCE, ?code=), finché
 * manca l'SMTP con il template personalizzato (docs/DEPLOY.md, ADR 002). Il flusso principale
 * resta /auth/confirm con token_hash e conferma con POST.
 *
 * Eccezione approvata a "ogni route handler chiama requireRole": è un callback di login, l'utente
 * non è ancora autenticato. Il ruolo si verifica subito dopo lo scambio: i cookie della nuova
 * sessione arrivano al browser solo per un cliente. Lo staff entra solo con email e password:
 * la sessione creata dal link viene revocata (solo quella) e l'eventuale sessione già aperta nel
 * browser non viene toccata.
 */
export async function GET(request: NextRequest) {
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return redirectTo(INVALID_LINK_PATH);

  // Cookie della richiesta più quelli scritti dallo scambio: restano in sospeso finché il ruolo
  // non è verificato.
  const jar = new Map(request.cookies.getAll().map((cookie) => [cookie.name, cookie.value]));
  const pending: CookieToSet[] = [];
  const { url, anonKey } = supabaseEnv();
  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          jar.set(cookie.name, cookie.value);
          pending.push(cookie);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) return redirectTo(INVALID_LINK_PATH);

  const user = await loadCurrentUser(supabase);
  if (!user || isStaffRole(user.role)) {
    await supabase.auth.signOut({ scope: "local" });
    const response = redirectTo(user ? STAFF_LOGIN_PATH : INVALID_LINK_PATH);
    // Solo la pulizia del code_verifier: nessun cookie di sessione nuovo arriva al browser.
    for (const cookie of pending) {
      if (cookie.name.endsWith("-code-verifier")) response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
    }
    return response;
  }

  const next = safeNextPath(nextFromEmailLink(request.url));
  const response = redirectTo(
    user.profileComplete ? destinationAfterLogin(next, user) : completeProfileUrl(COMPLETE_PROFILE_PATH, next),
  );
  for (const cookie of pending) response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
