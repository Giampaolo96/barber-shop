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
  decideAccess,
  isStaffRole,
} from "./access";
import { loadCurrentUser, requireRole } from "./current-user";
import { createEmailLinkVerifier, openCustomerSession } from "./email-link";
import { emailRedirectUrl, nextFromEmailLink, safeNextPath } from "./safe-next-path";
import {
  completeProfileSchema,
  emailLinkSchema,
  emailLoginSchema,
  staffLoginSchema,
} from "./schemas";

export type MagicLinkState = { status: "idle" | "sent" | "invalid" };
export type StaffLoginState = { status: "idle" | "invalid" | "disabled" };
export type CompleteProfileState = { status: "idle" | "invalid" | "error" };

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
  // L'esito non si mostra all'utente (niente enumerazione degli account); resta nei log.
  if (error) console.error("magic link non inviato:", error.code ?? error.message);

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
  if (result.status === "staff") redirect(STAFF_LOGIN_PATH);
  if (result.status === "invalid") redirect(invalidLink);

  revalidatePath("/", "layout");
  if (!result.user.profileComplete) redirect(COMPLETE_PROFILE_PATH);

  // La destinazione richiesta vale solo se è un percorso interno che l'utente può aprire.
  const next = safeNextPath(nextFromEmailLink(parsed.data.next));
  const path = new URL(next, "http://internal.invalid").pathname;
  const decision = decideAccess({ path, ...result.user });
  redirect(decision.type === "redirect" ? decision.to : next);
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
  redirect(HOME_PATH);
}

/** Logout: solo da form (POST), mai da un link. */
export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  revalidatePath("/", "layout");
  redirect(HOME_PATH);
}
