"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";
import {
  ADMIN_PATH,
  COMPLETE_PROFILE_PATH,
  CUSTOMER_LOGIN_PATH,
  HOME_PATH,
  STAFF_LOGIN_PATH,
  isStaffRole,
} from "./access";
import { loadCurrentUser, requireRole } from "./current-user";
import { createEmailLinkVerifier, type EmailLinkResult, openCustomerSession } from "./email-link";
import {
  checkLoginCode,
  clearLoginCode,
  registerLoginCodeFailure,
  resetLoginCode,
} from "./login-code";
import {
  completeProfileUrl,
  destinationAfterLogin,
  emailRedirectUrl,
  nextFromEmailLink,
  safeNextPath,
} from "./safe-next-path";
import {
  completeProfileSchema,
  emailLinkSchema,
  emailLoginSchema,
  loginCodeSchema,
  staffLoginSchema,
} from "./schemas";

export type MagicLinkState = { status: "idle" | "sent" | "invalid" | "rateLimited" | "error" };
export type StaffLoginState = { status: "idle" | "invalid" | "disabled" };
export type CompleteProfileState = { status: "idle" | "invalid" | "error" };
export type LoginCodeState =
  | { status: "idle" | "invalid" | "blocked" | "rateLimited" | "sessionFailed" }
  | { status: "wrong"; remaining: number };

/** Invio rifiutato per l'intervallo minimo tra due email o per il tetto orario di Supabase. */
const isEmailRateLimit = (error: { status?: number; code?: string }): boolean =>
  error.status === 429 || error.code === "over_email_send_rate_limit";

/** Invio del magic link: la risposta è la stessa che l'indirizzo sia registrato o no. */
export async function requestMagicLink(
  _previous: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = emailLoginSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { status: "invalid" };

  // Pagina da cui il cliente è stato mandato al login: ci torna dopo il link (solo percorsi interni).
  const next = safeNextPath(parsed.data.next);
  const origin = (await headers()).get("origin");
  const redirectTo =
    next !== "/" && origin && /^https?:\/\/[^/]+$/.test(origin)
      ? emailRedirectUrl(origin, next)
      : undefined;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
  });
  // Con shouldCreateUser anche un indirizzo nuovo riceve l'email: un errore non dice se l'account
  // esiste. Un 429 dice solo che di recente è già partita un'email (rischio accettato, ADR 009).
  // Senza invio il cliente non deve credere che l'email sia partita.
  if (error) {
    console.error("magic link non inviato:", error.code ?? error.message);
    return { status: isEmailRateLimit(error) ? "rateLimited" : "error" };
  }

  // Nuovo codice in arrivo: riparte il suo contatore dei tentativi. Solo se l'email è partita,
  // altrimenti si azzererebbe il limite senza un codice nuovo.
  await resetLoginCode(parsed.data.email).catch((resetError: unknown) =>
    console.error("contatore del codice non azzerato:", resetError),
  );
  return { status: "sent" };
}

/**
 * Accesso con il link ricevuto via email: il token si verifica solo qui, con la POST del
 * pulsante della pagina /auth/confirm, e la sessione si apre solo per i clienti.
 */
export async function confirmEmailLink(formData: FormData): Promise<void> {
  const invalidLink = CUSTOMER_LOGIN_PATH + "?errore=link";

  const parsed = emailLinkSchema.safeParse({
    tokenHash: formData.get("tokenHash"),
    type: formData.get("type"),
    next: formData.get("next"),
  });
  if (!parsed.success) redirect(invalidLink);

  const verifier = createEmailLinkVerifier();
  const { data, error } = await verifier.auth.verifyOtp({
    type: parsed.data.type,
    token_hash: parsed.data.tokenHash,
  });
  if (error || !data.session) redirect(invalidLink);

  const result = await openCustomerSession(verifier, data.session);
  if (result.status === "invalid") redirect(invalidLink);
  redirectAfterEmailSignIn(result, nextFromEmailLink(parsed.data.next));
}

/** Destinazione dopo il link o il codice: staff al proprio login, cliente a `next` o al profilo. */
function redirectAfterEmailSignIn(
  result: Exclude<EmailLinkResult, { status: "invalid" }>,
  requestedNext: string | null | undefined,
): never {
  if (result.status === "staff") redirect(STAFF_LOGIN_PATH);

  revalidatePath("/", "layout");
  // La destinazione richiesta vale solo se è un percorso interno che l'utente può aprire.
  const next = safeNextPath(requestedNext ?? undefined);
  // Al primo accesso la destinazione passa da /profilo/completa.
  if (!result.user.profileComplete) redirect(completeProfileUrl(COMPLETE_PROFILE_PATH, next));
  redirect(destinationAfterLogin(next, result.user));
}

/** Errore di GoTrue per troppe verifiche: non dice nulla sul codice, quindi non conta. */
const isRateLimit = (error: { status?: number; code?: string }): boolean =>
  error.status === 429 || error.code === "over_request_rate_limit";

/**
 * Accesso con il codice a 6 cifre dell'email (fetta 8, ADR 009): apre la sessione nel browser
 * (o nell'app installata) in cui il codice viene digitato. Stesse regole del link: solo clienti,
 * stesse destinazioni. Oltre il limite di tentativi il codice non viene nemmeno verificato.
 */
export async function verifyLoginCode(
  _previous: LoginCodeState,
  formData: FormData,
): Promise<LoginCodeState> {
  const parsed = loginCodeSchema.safeParse({
    email: formData.get("email"),
    token: formData.get("token"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { status: "invalid" };
  const { email, token } = parsed.data;

  try {
    if ((await checkLoginCode(email)).blocked) return { status: "blocked" };
  } catch (error) {
    // Senza il contatore non si verifica nulla: meglio un "riprova" che nessun limite.
    console.error("limite del codice non letto:", error);
    return { status: "rateLimited" };
  }

  const verifier = createEmailLinkVerifier();
  const { data, error } = await verifier.auth.verifyOtp({ email, token, type: "email" });
  if (error && isRateLimit(error)) return { status: "rateLimited" };
  if (error || !data.session) {
    try {
      const limit = await registerLoginCodeFailure(email);
      return limit.blocked ? { status: "blocked" } : { status: "wrong", remaining: limit.remaining };
    } catch (failureError) {
      console.error("errore del codice non contato:", failureError);
      return { status: "rateLimited" };
    }
  }

  await clearLoginCode(email).catch((clearError: unknown) =>
    console.error("contatori del codice non azzerati:", clearError),
  );

  const result = await openCustomerSession(verifier, data.session);
  // Codice giusto (e ormai consumato) ma sessione non aperta: non è un errore del cliente.
  if (result.status === "invalid") return { status: "sessionFailed" };
  redirectAfterEmailSignIn(result, parsed.data.next);
}

/** Login dello staff: errore generico per qualunque credenziale non valida. */
export async function staffLogin(
  _previous: StaffLoginState,
  formData: FormData,
): Promise<StaffLoginState> {
  const parsed = staffLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { status: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { status: "invalid" };

  // Il ruolo si legge da profiles: un cliente con credenziali valide non è staff e non
  // deve distinguere il proprio caso da una password sbagliata.
  const user = await loadCurrentUser(supabase);
  if (!user || !isStaffRole(user.role)) {
    await supabase.auth.signOut({ scope: "local" });
    return { status: "invalid" };
  }
  if (user.isBlocked) {
    await supabase.auth.signOut({ scope: "local" });
    return { status: "disabled" };
  }

  revalidatePath("/", "layout");
  redirect(ADMIN_PATH);
}

/** Completamento del profilo del cliente: nome, telefono in E.164 e consensi. */
export async function completeProfile(
  _previous: CompleteProfileState,
  formData: FormData,
): Promise<CompleteProfileState> {
  const user = await requireRole(["customer"]);

  const parsed = completeProfileSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    privacyConsent: formData.get("privacyConsent") === "on",
    marketingConsent: formData.get("marketingConsent") === "on",
  });
  if (!parsed.success) return { status: "invalid" };

  const supabase = await createClient();
  const [{ data: settings }, { data: profile }] = await Promise.all([
    supabase.from("shop_settings").select("privacy_policy_version").maybeSingle(),
    supabase.from("profiles").select("privacy_consent_at").eq("id", user.id).maybeSingle(),
  ]);
  if (!settings || !profile) return { status: "error" };

  // I timestamp dei consensi li mette il database. La versione accettata si scrive solo
  // la prima volta: il consenso privacy già dato non si può modificare.
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
      marketing_consent: parsed.data.marketingConsent,
      ...(profile.privacy_consent_at === null
        ? { privacy_policy_version: settings.privacy_policy_version }
        : {}),
    })
    .eq("id", user.id)
    .select("id");
  // Un update che non tocca righe (RLS) non dà errore: va trattato come fallito.
  if (error || updated.length !== 1) {
    console.error("profilo non salvato:", error?.code ?? "nessuna riga aggiornata");
    return { status: "error" };
  }

  revalidatePath("/", "layout");
  // Torna alla pagina da cui il cliente era partito (es. nel mezzo di una prenotazione).
  const next = safeNextPath(formData.get("next")?.toString());
  redirect(destinationAfterLogin(next, { ...user, profileComplete: true }));
}

/** Logout: solo da form (POST), mai da un link. */
export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  revalidatePath("/", "layout");
  redirect(HOME_PATH);
}
