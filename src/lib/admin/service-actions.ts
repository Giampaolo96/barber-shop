"use server";

// Servizi (SPEC §3.2, §6.4): creazione, modifica, attivazione, ordinamento, eliminazione.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";
import { countFutureConfirmed } from "./queries";
import { idSchema, moveSchema, optionalIdSchema, serviceSchema } from "./schemas";

export type ServiceFormState = {
  status: "idle" | "saved" | "invalid" | "error";
  /** Prenotazioni future confermate di un servizio appena salvato disattivato (null: non verificate). */
  futureBookings?: number | null;
};

export type ServiceRowState = { status: "idle" | "ok" | "has_bookings" | "stale" | "error" };

const SERVICES_PATH = "/admin/servizi";
const FOREIGN_KEY_VIOLATION = "23503";
const INVALID_PARAMETER = "22023";

export async function saveService(
  _previous: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  await requireRole(["admin"]);

  const target = optionalIdSchema.safeParse({ id: formData.get("id") || null });
  const parsed = serviceSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    durationMin: formData.get("durationMin"),
    price: formData.get("price"),
    isActive: formData.get("isActive") === "on",
  });
  if (!target.success || !parsed.success) return { status: "invalid" };
  const service = parsed.data;
  const values = {
    name: service.name,
    description: service.description,
    duration_min: service.durationMin,
    price_cents: service.priceCents,
    is_active: service.isActive,
  };

  const supabase = await createClient();
  const id = target.data.id;

  if (!id) {
    // In coda all'elenco.
    const { data: last } = await supabase
      .from("services")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase
      .from("services")
      .insert({ ...values, sort_order: (last?.sort_order ?? 0) + 1 });
    if (error) return { status: "error" };
    revalidatePath(SERVICES_PATH);
    redirect(SERVICES_PATH);
  }

  const { data: updated, error } = await supabase
    .from("services")
    .update(values)
    .eq("id", id)
    .select("id");
  if (error || updated.length !== 1) return { status: "error" };

  revalidatePath(SERVICES_PATH);
  // SPEC §12: le prenotazioni future restano valide, l'admin viene solo avvisato.
  const futureBookings = service.isActive ? 0 : await countFutureConfirmed(supabase, "service_id", id);
  return { status: "saved", futureBookings };
}

/** Elimina un servizio senza prenotazioni; con prenotazioni va disattivato (FK restrict). */
export async function deleteService(
  _previous: ServiceRowState,
  formData: FormData,
): Promise<ServiceRowState> {
  await requireRole(["admin"]);

  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { status: "error" };

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("services")
    .delete()
    .eq("id", parsed.data.id)
    .select("id");
  if (error?.code === FOREIGN_KEY_VIOLATION) return { status: "has_bookings" };
  if (error || deleted.length !== 1) return { status: "error" };

  revalidatePath(SERVICES_PATH);
  return { status: "ok" };
}

/** Sposta un servizio di una posizione, riscrivendo l'ordine di tutto il catalogo. */
export async function moveService(
  _previous: ServiceRowState,
  formData: FormData,
): Promise<ServiceRowState> {
  await requireRole(["admin"]);

  const parsed = moveSchema.safeParse({ id: formData.get("id"), direction: formData.get("direction") });
  if (!parsed.success) return { status: "error" };
  const { id, direction } = parsed.data;

  const supabase = await createClient();
  // L'elenco si rilegge al momento del clic: reorder_services vuole tutti i servizi, e se nel
  // frattempo ne è stato aggiunto o tolto uno si riprova con l'elenco aggiornato.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: services, error: readError } = await supabase
      .from("services")
      .select("id")
      .order("sort_order")
      .order("id");
    if (readError) return { status: "error" };

    const ids = services.map((service) => service.id);
    const from = ids.indexOf(id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from < 0) return { status: "stale" };
    if (to < 0 || to >= ids.length) return { status: "ok" };
    [ids[from], ids[to]] = [ids[to], ids[from]];

    const { error } = await supabase.rpc("reorder_services", { p_ids: ids });
    if (!error) {
      revalidatePath(SERVICES_PATH);
      return { status: "ok" };
    }
    if (error.code !== INVALID_PARAMETER) return { status: "error" };
  }
  return { status: "stale" };
}
