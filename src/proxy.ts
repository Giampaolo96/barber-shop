import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  COMPLETE_PROFILE_PATH,
  CUSTOMER_LOGIN_PATH,
  DISABLED_REASON,
  STAFF_LOGIN_PATH,
  decideAccess,
  isStaffRole,
} from "@/lib/auth/access";
import { emailLinkFallback } from "@/lib/auth/email-fallback";
import { ACCESS_PROFILE_COLUMNS, toCurrentUser } from "@/lib/auth/profile";
import type { CurrentUser } from "@/lib/auth/profile";
import { supabaseEnv } from "@/lib/db/env";
import type { Database } from "@/lib/db/database";

// Rinnova la sessione e applica le regole di accesso prima del rendering. È un primo
// filtro: pagine e server action ricontrollano comunque il ruolo.
export async function proxy(request: NextRequest) {
  // Link del template email predefinito (?code= o errore): prima di tutto il resto.
  const fallback = emailLinkFallback(request.nextUrl);
  if (fallback) return NextResponse.redirect(new URL(fallback, request.url));

  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims() verifica il token (e lo rinnova se scaduto); il ruolo si legge da profiles.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;

  let user: CurrentUser | null = null;
  if (userId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select(ACCESS_PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle();
    if (profile) user = toCurrentUser(userId, profile);
  }

  const decision = decideAccess({
    path: request.nextUrl.pathname,
    role: user?.role ?? null,
    isBlocked: user?.isBlocked ?? false,
    profileComplete: user?.profileComplete ?? false,
  });
  if (decision.type === "allow") return response;

  const target = request.nextUrl.clone();
  target.pathname = decision.to;
  target.search = "";
  // Anonimo su una pagina privata del cliente (dopo il login) o cliente con il profilo da
  // completare (dopo il salvataggio): poi torna lì, parametri compresi.
  if (
    (!user && decision.to === CUSTOMER_LOGIN_PATH) ||
    (user?.role === "customer" && decision.to === COMPLETE_PROFILE_PATH)
  ) {
    target.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  }

  // Staff bloccato a sessione aperta: resta fuori da /admin e la sessione del browser
  // viene chiusa togliendo i cookie di autenticazione.
  if (user && isStaffRole(user.role) && user.isBlocked && decision.to === STAFF_LOGIN_PATH) {
    target.searchParams.set("motivo", DISABLED_REASON);
    const blockedResponse = NextResponse.redirect(target);
    for (const { name } of request.cookies.getAll()) {
      if (name.startsWith("sb-") && name.includes("-auth-token")) blockedResponse.cookies.delete(name);
    }
    return blockedResponse;
  }

  const redirectResponse = NextResponse.redirect(target);
  for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
  return redirectResponse;
}

export const config = {
  // Tutto tranne gli asset di Next e i file statici con estensione nota: un percorso
  // applicativo che contiene un punto (es. /admin/clienti/mario.rossi) passa dal proxy.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|json|webmanifest|woff2?)$).*)",
  ],
};
