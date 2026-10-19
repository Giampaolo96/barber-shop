import "server-only";
import { cache } from "react";

// Letture per il flusso di prenotazione e "Le mie prenotazioni", con il client della richiesta:
// la RLS limita il catalogo alle voci attive e le prenotazioni a quelle del cliente.
import { barberPhotoUrl } from "@/lib/barbers/photo";
import { createClient } from "@/lib/db/server";

export type ShopInfo = {
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  maxHorizonDays: number;
  cancelLimitMin: number;
  noShowBlockThreshold: number;
  /** Impostazioni del motore di disponibilità (SPEC §3.1). */
  slotGranularityMin: number;
  minAdvanceMin: number;
  bufferMin: number;
};

export type BookableService = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  /** Barbieri attivi abilitati: con uno solo il passo del barbiere si salta. */
  barberIds: string[];
};

export type BookableBarber = { id: string; name: string; photoUrl: string | null };

export type MyBooking = {
  id: string;
  startsAt: string;
  status: string;
  durationMin: number;
  priceCents: number;
  notes: string | null;
  serviceName: string;
  barberName: string;
};

/** Impostazioni del negozio, lette una volta per richiesta (layout, pagina e disponibilità). */
export const getShopInfo = cache(async (): Promise<ShopInfo | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shop_settings")
    .select(
      "name, address, phone, timezone, max_horizon_days, cancel_limit_min, no_show_block_threshold, slot_granularity_min, min_advance_min, buffer_min",
    )
    .maybeSingle();
  if (error) console.error("getShopInfo", error);
  if (!data) return null;
  return {
    name: data.name,
    address: data.address,
    phone: data.phone,
    timezone: data.timezone,
    maxHorizonDays: data.max_horizon_days,
    cancelLimitMin: data.cancel_limit_min,
    noShowBlockThreshold: data.no_show_block_threshold,
    slotGranularityMin: data.slot_granularity_min,
    minAdvanceMin: data.min_advance_min,
    bufferMin: data.buffer_min,
  };
});

/** Servizi attivi con almeno un barbiere attivo abilitato, nell'ordine del catalogo (una lettura per richiesta). */
export const getBookableServices = cache(async (): Promise<BookableService[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, description, duration_min, price_cents, barber_services!inner(barbers!inner(id))",
    )
    .eq("is_active", true)
    .eq("barber_services.barbers.is_active", true)
    .order("sort_order")
    .order("name");
  if (error) console.error("getBookableServices", error);
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    durationMin: s.duration_min,
    priceCents: s.price_cents,
    barberIds: s.barber_services.map((bs) => bs.barbers.id),
  }));
});

export async function getBookableService(serviceId: string): Promise<BookableService | null> {
  const services = await getBookableServices();
  return services.find((s) => s.id === serviceId) ?? null;
}

/** Barbieri attivi abilitati al servizio, in ordine di nome. */
export async function getBarbersForService(serviceId: string): Promise<BookableBarber[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("barber_services")
    .select("barbers!inner(id, display_name, photo_path, is_active)")
    .eq("service_id", serviceId)
    .eq("barbers.is_active", true);
  if (error) console.error("getBarbersForService", error);
  return (data ?? [])
    .map(({ barbers: b }) => ({ id: b.id, name: b.display_name, photoUrl: barberPhotoUrl(b.photo_path) }))
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
}

/** Colonne di "Le mie prenotazioni" (nomi di servizio e barbiere leggibili anche se disattivati). */
const MY_BOOKING_COLUMNS =
  "id, starts_at, status, duration_min, price_cents, notes, services(name), barbers(display_name)";

type MyBookingRow = {
  id: string;
  starts_at: string;
  status: string;
  duration_min: number;
  price_cents: number;
  notes: string | null;
  services: { name: string } | null;
  barbers: { display_name: string } | null;
};

const toMyBooking = (b: MyBookingRow): MyBooking => ({
  id: b.id,
  startsAt: b.starts_at,
  status: b.status,
  durationMin: b.duration_min,
  priceCents: b.price_cents,
  notes: b.notes,
  serviceName: b.services?.name ?? "",
  barberName: b.barbers?.display_name ?? "",
});

/** Prenotazioni del cliente (RLS: solo le proprie); null se la lettura non riesce. */
export async function getMyBookings(customerId: string): Promise<MyBooking[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(MY_BOOKING_COLUMNS)
    .eq("customer_id", customerId)
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("getMyBookings", error);
    return null;
  }
  return data.map(toMyBooking);
}

/** Prenotazione del cliente con la fine, per la conferma e il file .ics (fetta 8b). */
export type OwnBooking = MyBooking & { endsAt: string };

/**
 * Una prenotazione del cliente (RLS: solo le proprie, mai la service role). `booking` null se non
 * esiste o è di un altro cliente; `ok: false` se la lettura non riesce.
 */
export async function getOwnBooking(
  customerId: string,
  bookingId: string,
): Promise<{ ok: true; booking: OwnBooking | null } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(`${MY_BOOKING_COLUMNS}, ends_at`)
    .eq("id", bookingId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) {
    console.error("getOwnBooking", error);
    return { ok: false };
  }
  return { ok: true, booking: data ? { ...toMyBooking(data), endsAt: data.ends_at } : null };
}

/** Prima prenotazione confermata non ancora iniziata (`booking` null se non c'è). */
export async function getNextBooking(
  customerId: string,
): Promise<{ ok: true; booking: MyBooking | null } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(MY_BOOKING_COLUMNS)
    .eq("customer_id", customerId)
    .eq("status", "confirmed")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("getNextBooking", error);
    return { ok: false };
  }
  return { ok: true, booking: data ? toMyBooking(data) : null };
}
