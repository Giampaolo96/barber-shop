"use server";

// Account staff (SPEC §2, §3.3, §5.5): l'admin crea l'account di un barbiere, collega un account
// staff esistente a una scheda, blocca e sblocca. È l'unico modulo che usa il service role, e
// solo per ciò che la RLS non può fare: creare utenti in Auth e revocarne le sessioni.
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { barberIdSchema, staffAccountSchema, staffBlockSchema, staffLinkSchema } from "./schemas";

export type StaffAccountState = {
  status: "idle" | "created" | "invalid" | "email_taken" | "barber_has_account" | "stale" | "error";
};

export type StaffActionState = {
  status:
    | "idle"
    | "ok"
    | "invalid"
    | "not_staff"
    | "self"
    | "barber_has_account"
    | "account_linked"
    | "stale"
    | "error";
};

const BARBERS_PATH = "/admin/barbieri";
/** Guardia barbers_guard_account_link: la scheda è già collegata a un altro account. */
const ACCOUNT_ALREADY_LINKED = "55000";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Collegamenti scheda → account: `profile_id` non è leggibile direttamente (ADR 001). */
const readBarberAccounts = async (supabase: ServerClient) => {
  const { data, error } = await supabase.rpc("barber_accounts");
  return error ? null : data;
};

/** Crea l'account di un barbiere e lo collega alla scheda. Il ruolo è sempre `barber`. */
export async function createStaffAccount(
  _previous: StaffAccountState,
  formData: FormData,
): Promise<StaffAccountState> {
  await requireRole(["admin"]);

  const parsed = staffAccountSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
    barberId: formData.get("barberId"),
  });
  if (!parsed.success) return { status: "invalid" };
  const { email, password, displayName, barberId } = parsed.data;

  const supabase = await createClient();
  const { data: barber } = await supabase
    .from("barbers")
    .select("id")
    .eq("id", barberId)
    .maybeSingle();
  const accounts = await readBarberAccounts(supabase);
  if (!barber || !accounts) return { status: "error" };
  if (accounts.some((row) => row.barber_id === barberId && row.profile_id !== null)) {
    return { status: "barber_has_account" };
  }

  // Lo staff non conferma l'email: l'admin comunica la password iniziale di persona.
  const admin = createAdminClient();
  // Il nome va nel profilo qui sotto: i metadati dell'utente non si usano (ADR 002).
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    // Email già registrata: nessuna conversione automatica di un cliente in barbiere.
    if (createError?.code === "email_exists") return { status: "email_taken" };
    console.error("account staff non creato:", createError?.code ?? "nessun utente");
    return { status: "error" };
  }
  const userId = created.user.id;

  // Ruolo e collegamento passano dal client dell'admin: valgono RLS e trigger di guardia.
  const { data: promoted } = await supabase
    .from("profiles")
    .update({ role: "barber", full_name: displayName })
    .eq("id", userId)
    .select("id");
  const { data: linked, error: linkError } = await supabase
    .from("barbers")
    .update({ profile_id: userId })
    .eq("id", barberId)
    .select("id");

  if (promoted?.length !== 1 || linked?.length !== 1) {
    // Niente account staff a metà: l'utente appena creato si elimina.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error(
        "account staff non completato e non eliminato: utente Auth orfano da eliminare a mano",
        userId,
        deleteError.code ?? deleteError.message,
      );
    } else {
      console.error("account staff non completato, utente eliminato", userId);
    }
    // Nel frattempo un altro admin ha collegato la scheda (guardia nel database).
    if (linkError?.code === ACCOUNT_ALREADY_LINKED) return { status: "stale" };
    return { status: "error" };
  }

  revalidatePath(BARBERS_PATH, "layout");
  return { status: "created" };
}

/** Collega un account staff esistente (anche l'admin stesso) a una scheda senza account. */
export async function linkStaffAccount(
  _previous: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  await requireRole(["admin"]);

  const parsed = staffLinkSchema.safeParse({
    barberId: formData.get("barberId"),
    profileId: formData.get("profileId"),
  });
  if (!parsed.success) return { status: "invalid" };
  const { barberId, profileId } = parsed.data;

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", profileId)
    .maybeSingle();
  if (!target || target.role === "customer") return { status: "not_staff" };

  const accounts = await readBarberAccounts(supabase);
  if (!accounts) return { status: "error" };
  const card = accounts.find((row) => row.barber_id === barberId);
  if (!card) return { status: "invalid" };
  if (card.profile_id !== null) return { status: "barber_has_account" };
  if (accounts.some((row) => row.profile_id === profileId)) return { status: "account_linked" };

  // Niente filtro su profile_id: la colonna non è leggibile da authenticated (ADR 001). Se nel
  // frattempo la scheda è stata collegata, la guardia del database rifiuta l'update; il vincolo
  // unique impedisce due schede sullo stesso account.
  const { data: linked, error } = await supabase
    .from("barbers")
    .update({ profile_id: profileId })
    .eq("id", barberId)
    .select("id");
  if (error?.code === ACCOUNT_ALREADY_LINKED) return { status: "stale" };
  if (error) return { status: "error" };
  if (linked.length !== 1) return { status: "stale" };

  revalidatePath(BARBERS_PATH, "layout");
  return { status: "ok" };
}

/** Scollega l'account dalla scheda: l'account resta, senza scheda barbiere. */
export async function unlinkStaffAccount(
  _previous: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  await requireRole(["admin"]);

  const parsed = barberIdSchema.safeParse({ barberId: formData.get("barberId") });
  if (!parsed.success) return { status: "invalid" };

  const supabase = await createClient();
  const { data: unlinked, error } = await supabase
    .from("barbers")
    .update({ profile_id: null })
    .eq("id", parsed.data.barberId)
    .select("id");
  if (error || unlinked.length !== 1) return { status: "error" };

  revalidatePath(BARBERS_PATH, "layout");
  return { status: "ok" };
}

/**
 * Blocca o sblocca un account staff. Il blocco revoca anche le sessioni lato server: gli
 * access token già emessi restano validi fino alla scadenza, ma senza privilegi nella RLS.
 */
export async function setStaffBlocked(
  _previous: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const user = await requireRole(["admin"]);

  const parsed = staffBlockSchema.safeParse({
    profileId: formData.get("profileId"),
    blocked: formData.get("blocked"),
  });
  if (!parsed.success) return { status: "invalid" };
  const { profileId, blocked } = parsed.data;
  if (profileId === user.id) return { status: "self" };

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", profileId)
    .maybeSingle();
  // I clienti si bloccano dalla sezione Clienti (SPEC §6.7), non da qui.
  if (!target || target.role === "customer") return { status: "not_staff" };

  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ is_blocked: blocked })
    .eq("id", profileId)
    .select("id");
  if (error || updated.length !== 1) return { status: "error" };

  if (blocked) {
    const { error: revokeError } = await createAdminClient().rpc("revoke_user_sessions", {
      p_user_id: profileId,
    });
    if (revokeError) {
      console.error("sessioni non revocate:", revokeError.code);
      return { status: "error" };
    }
  }

  revalidatePath(BARBERS_PATH, "layout");
  return { status: "ok" };
}
