"use server";

// Account del cliente (fetta 9b, SPEC §5.4, §8): modifica del profilo, nuovo consenso dopo un cambio
// dell'informativa, eliminazione con anonimizzazione dello storico (ADR 016).
import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { HOME_PATH } from "./access";
import { requireRole } from "./current-user";
import { safeNextPath } from "./safe-next-path";
import { profileUpdateSchema } from "./schemas";

export type ProfileFormState = { status: "idle" | "saved" | "invalid" | "error" };
export type ReconsentState = { status: "idle" | "invalid" | "error" };
export type DeleteAccountState = { status: "idle" | "error" };

/** Nome, telefono e consenso marketing: i timestamp dei consensi li scrive il database. */
export async function updateProfile(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireRole(["customer"]);

  const parsed = profileUpdateSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    marketingConsent: formData.get("marketingConsent") === "on",
  });
  if (!parsed.success) return { status: "invalid" };

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
      marketing_consent: parsed.data.marketingConsent,
    })
    .eq("id", user.id)
    .select("id");
  // Un update che non tocca righe (RLS) non dà errore: va trattato come fallito.
  if (error || updated.length !== 1) {
    console.error("profilo non salvato:", error?.code ?? "nessuna riga aggiornata");
    return { status: "error" };
  }

  revalidatePath("/", "layout");
  return { status: "saved" };
}

/** Consenso alla versione corrente dell'informativa; poi si torna dove si era (`next` sicuro). */
export async function acceptPrivacyUpdate(
  _previous: ReconsentState,
  formData: FormData,
): Promise<ReconsentState> {
  const user = await requireRole(["customer"]);
  if (formData.get("privacyConsent") !== "on") return { status: "invalid" };

  const supabase = await createClient();
  const { data: settings } = await supabase.from("shop_settings").select("privacy_policy_version").maybeSingle();
  if (!settings) return { status: "error" };

  // La data la mette il trigger; la versione deve essere quella corrente (controllo nel database).
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ privacy_policy_version: settings.privacy_policy_version })
    .eq("id", user.id)
    .select("id");
  if (error || updated.length !== 1) {
    console.error("nuovo consenso non salvato:", error?.code ?? "nessuna riga aggiornata");
    return { status: "error" };
  }

  revalidatePath("/", "layout");
  redirect(safeNextPath(formData.get("next")?.toString()));
}

/**
 * Eliminazione dell'account: 1) delete_own_account con la sessione del cliente (future cancellate,
 * storico anonimizzato); 2) utente Auth eliminato con la service role, che a cascata elimina il
 * profilo; 3) logout e home con il messaggio. Se il passo 2 fallisce l'account resta intero e il
 * cliente può riprovare: i passi sono ripetibili e non resta mai un utente Auth senza profilo.
 */
// Senza parametri: lo stato precedente e il modulo (solo il pulsante) non servono.
export async function deleteAccount(): Promise<DeleteAccountState> {
  const user = await requireRole(["customer"]);
  const supabase = await createClient();

  const { error: anonymizeError } = await supabase.rpc("delete_own_account");
  if (anonymizeError) {
    console.error("eliminazione account, anonimizzazione:", anonymizeError.code, user.id);
    return { status: "error" };
  }

  // Service role solo per questa chiamata, con l'id della sessione verificata (mai dal modulo).
  const { error: deleteError } = await createAdminClient().auth.admin.deleteUser(user.id);
  if (deleteError) {
    // Solo id e codice: nel log nessun dato personale.
    console.error("eliminazione account, utente Auth:", deleteError.status ?? deleteError.name, user.id);
    return { status: "error" };
  }

  await supabase.auth.signOut({ scope: "local" });
  revalidatePath("/", "layout");
  redirect(`${HOME_PATH}?account=eliminato`);
}
