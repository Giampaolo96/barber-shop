"use server";

// Barbieri (SPEC §3.3, §3.4, §6.5): scheda, servizi abilitati, orari settimanali, eliminazione.
// Le colonne di barbers si elencano sempre (grant di colonna, ADR 001).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { removePhotoFile } from "@/lib/barbers/photo-storage";
import { createClient } from "@/lib/db/server";
import { countFutureConfirmed } from "./queries";
import { barberIdSchema, barberSchema, idSchema, optionalIdSchema, weeklyHoursSchema } from "./schemas";

export type BarberFormState = {
  status: "idle" | "saved" | "invalid" | "error";
  /** Prenotazioni future confermate di un barbiere appena salvato disattivato (null: non verificate). */
  futureBookings?: number | null;
};

export type BarberRowState = { status: "idle" | "ok" | "has_bookings" | "error" };

export type HoursState = { status: "idle" | "saved" | "invalid" | "overlap" | "error" };

const BARBERS_PATH = "/admin/barbieri";
const FOREIGN_KEY_VIOLATION = "23503";
const EXCLUSION_VIOLATION = "23P01";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Allinea i servizi abilitati all'elenco scelto. */
const syncBarberServices = async (
  supabase: ServerClient,
  barberId: string,
  serviceIds: string[],
): Promise<boolean> => {
  const { data: current, error } = await supabase
    .from("barber_services")
    .select("service_id")
    .eq("barber_id", barberId);
  if (error) return false;

  const existing = new Set(current.map((row) => row.service_id));
  const wanted = new Set(serviceIds);
  const toRemove = [...existing].filter((id) => !wanted.has(id));
  const toAdd = [...wanted].filter((id) => !existing.has(id));

  if (toRemove.length > 0) {
    const { error: removeError } = await supabase
      .from("barber_services")
      .delete()
      .eq("barber_id", barberId)
      .in("service_id", toRemove);
    if (removeError) return false;
  }
  if (toAdd.length > 0) {
    const { error: addError } = await supabase
      .from("barber_services")
      .insert(toAdd.map((serviceId) => ({ barber_id: barberId, service_id: serviceId })));
    if (addError) return false;
  }
  return true;
};

export async function saveBarber(
  _previous: BarberFormState,
  formData: FormData,
): Promise<BarberFormState> {
  await requireRole(["admin"]);

  const target = optionalIdSchema.safeParse({ id: formData.get("id") || null });
  const parsed = barberSchema.safeParse({
    displayName: formData.get("displayName"),
    bio: formData.get("bio"),
    isActive: formData.get("isActive") === "on",
    serviceIds: formData.getAll("serviceIds"),
  });
  if (!target.success || !parsed.success) return { status: "invalid" };
  const barber = parsed.data;
  const values = {
    display_name: barber.displayName,
    bio: barber.bio,
    is_active: barber.isActive,
  };

  const supabase = await createClient();
  let id = target.data.id;

  if (!id) {
    const { data: created, error } = await supabase
      .from("barbers")
      .insert(values)
      .select("id")
      .single();
    if (error) return { status: "error" };
    id = created.id;
  } else {
    const { data: updated, error } = await supabase
      .from("barbers")
      .update(values)
      .eq("id", id)
      .select("id");
    if (error || updated.length !== 1) return { status: "error" };
  }

  if (!(await syncBarberServices(supabase, id, barber.serviceIds))) return { status: "error" };
  revalidatePath(BARBERS_PATH, "layout");

  if (!target.data.id) redirect(`${BARBERS_PATH}/${id}`);
  const futureBookings = barber.isActive ? 0 : await countFutureConfirmed(supabase, "barber_id", id);
  return { status: "saved", futureBookings };
}

/** Elimina un barbiere senza prenotazioni (e il suo ritratto); con prenotazioni va disattivato (FK restrict). */
export async function deleteBarber(
  _previous: BarberRowState,
  formData: FormData,
): Promise<BarberRowState> {
  await requireRole(["admin"]);

  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { status: "error" };

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("barbers")
    .delete()
    .eq("id", parsed.data.id)
    .select("id, photo_path");
  if (error?.code === FOREIGN_KEY_VIOLATION) return { status: "has_bookings" };
  if (error || deleted.length !== 1) return { status: "error" };

  // Il ritratto se ne va con il barbiere; se la cancellazione del file fallisce resta un file
  // orfano nel bucket, ma il barbiere è già eliminato (fetta 8d).
  const photoPath = deleted[0].photo_path;
  if (photoPath) await removePhotoFile(supabase, parsed.data.id, photoPath);

  revalidatePath(BARBERS_PATH, "layout");
  return { status: "ok" };
}

/** Sostituisce tutta la settimana di un barbiere (set_working_hours, atomica). */
export async function saveWorkingHours(
  _previous: HoursState,
  formData: FormData,
): Promise<HoursState> {
  await requireRole(["admin"]);

  const target = barberIdSchema.safeParse({ barberId: formData.get("barberId") });
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("hours") ?? ""));
  } catch {
    return { status: "invalid" };
  }
  const parsed = weeklyHoursSchema.safeParse(raw);
  if (!target.success) return { status: "invalid" };
  if (!parsed.success) {
    const overlap = parsed.error.issues.some((issue) => issue.message === "overlap");
    return { status: overlap ? "overlap" : "invalid" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_working_hours", {
    p_barber_id: target.data.barberId,
    p_hours: parsed.data.map((slot) => ({
      weekday: slot.weekday,
      start_time: slot.start,
      end_time: slot.end,
    })),
  });
  if (error?.code === EXCLUSION_VIOLATION) return { status: "overlap" };
  if (error) return { status: "error" };

  revalidatePath(`${BARBERS_PATH}/${target.data.barberId}/orari`);
  return { status: "saved" };
}
