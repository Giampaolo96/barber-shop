"use server";

// Assenze dei barbieri e chiusure del negozio (SPEC §3.5, §6.5, §6.6). Il modulo è in ora locale
// del negozio, il database in UTC. Nessuna prenotazione viene cancellata: se il periodo copre
// prenotazioni confermate, l'utente riceve solo un avviso con il loro numero (decisione fetta 3).
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";
import { periodToUtc } from "./periods";
import { countConfirmedOverlapping, getOwnBarberId, getShopTimezone } from "./queries";
import { closureSchema, idSchema, optionalIdSchema, timeOffSchema } from "./schemas";

export type PeriodFormState = {
  status: "idle" | "saved" | "invalid" | "error";
  /** Prenotazioni confermate che si sovrappongono al periodo salvato (null: non verificate). */
  overlapping?: number | null;
};

export type PeriodRowState = { status: "idle" | "ok" | "error" };

const ADMIN_AREA = "/admin";

/** Campi del modulo dei periodi: solo quelli della modalità scelta. */
const periodInput = (formData: FormData) =>
  formData.get("mode") === "allDay"
    ? {
        mode: "allDay",
        fromDate: formData.get("fromDate"),
        toDate: formData.get("toDate"),
        reason: formData.get("reason"),
      }
    : {
        mode: formData.get("mode"),
        start: formData.get("start"),
        end: formData.get("end"),
        reason: formData.get("reason"),
      };

/**
 * Assenza di un barbiere. L'admin indica la scheda (`barberId`); il barbiere scrive sempre
 * sulla propria, qualunque cosa arrivi dal modulo (la RLS lo garantisce comunque).
 */
export async function saveTimeOff(
  _previous: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const user = await requireRole(["barber", "admin"]);

  const target = optionalIdSchema.safeParse({ id: formData.get("id") || null });
  const chosenBarber = optionalIdSchema.safeParse({ id: formData.get("barberId") || null });
  const parsed = timeOffSchema.safeParse(periodInput(formData));
  if (!target.success || !chosenBarber.success || !parsed.success) return { status: "invalid" };

  const supabase = await createClient();
  const { startsAt, endsAt } = periodToUtc(parsed.data, await getShopTimezone(supabase));
  const values = {
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    reason: parsed.data.reason,
  };

  let barberId: string;
  if (target.data.id) {
    // In modifica la scheda non cambia.
    const { data: updated, error } = await supabase
      .from("time_off")
      .update(values)
      .eq("id", target.data.id)
      .select("barber_id");
    if (error || updated.length !== 1) return { status: "error" };
    barberId = updated[0].barber_id;
  } else {
    const ownBarberId = await getOwnBarberId(supabase);
    const chosen = user.role === "admin" ? (chosenBarber.data.id ?? ownBarberId) : ownBarberId;
    if (!chosen) return { status: "error" };
    const { error } = await supabase.from("time_off").insert({ ...values, barber_id: chosen });
    if (error) return { status: "error" };
    barberId = chosen;
  }

  revalidatePath(ADMIN_AREA, "layout");
  const overlapping = await countConfirmedOverlapping(supabase, startsAt, endsAt, barberId);
  return { status: "saved", overlapping };
}

export async function deleteTimeOff(
  _previous: PeriodRowState,
  formData: FormData,
): Promise<PeriodRowState> {
  await requireRole(["barber", "admin"]);

  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { status: "error" };

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("time_off")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");
  if (error || deleted.length !== 1) return { status: "error" };

  revalidatePath(ADMIN_AREA, "layout");
  return { status: "ok" };
}

/** Chiusura dell'intero negozio: l'avviso conta le prenotazioni di tutti i barbieri. */
export async function saveClosure(
  _previous: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  await requireRole(["admin"]);

  const target = optionalIdSchema.safeParse({ id: formData.get("id") || null });
  const parsed = closureSchema.safeParse(periodInput(formData));
  if (!target.success || !parsed.success) return { status: "invalid" };

  const supabase = await createClient();
  const { startsAt, endsAt } = periodToUtc(parsed.data, await getShopTimezone(supabase));
  const values = {
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    reason: parsed.data.reason,
  };

  if (target.data.id) {
    const { data: updated, error } = await supabase
      .from("shop_closures")
      .update(values)
      .eq("id", target.data.id)
      .select("id");
    if (error || updated.length !== 1) return { status: "error" };
  } else {
    const { error } = await supabase.from("shop_closures").insert(values);
    if (error) return { status: "error" };
  }

  revalidatePath(ADMIN_AREA, "layout");
  const overlapping = await countConfirmedOverlapping(supabase, startsAt, endsAt);
  return { status: "saved", overlapping };
}

export async function deleteClosure(
  _previous: PeriodRowState,
  formData: FormData,
): Promise<PeriodRowState> {
  await requireRole(["admin"]);

  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { status: "error" };

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("shop_closures")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");
  if (error || deleted.length !== 1) return { status: "error" };

  revalidatePath(ADMIN_AREA, "layout");
  return { status: "ok" };
}
