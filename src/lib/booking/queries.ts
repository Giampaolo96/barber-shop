import "server-only";

// Letture per il flusso di prenotazione e "Le mie prenotazioni", con il client della richiesta:
// la RLS limita il catalogo alle voci attive e le prenotazioni a quelle del cliente.
import { createClient } from "@/lib/db/server";

export type ShopInfo = {
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  maxHorizonDays: number;
  cancelLimitMin: number;
  noShowBlockThreshold: number;
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

export type BookableBarber = { id: string; name: string; photoUrl: string | null; bio: string | null };

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

export async function getShopInfo(): Promise<ShopInfo | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shop_settings")
    .select("name, address, phone, timezone, max_horizon_days, cancel_limit_min, no_show_block_threshold")
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
  };
}

/** Servizi attivi con almeno un barbiere attivo abilitato, nell'ordine del catalogo. */
export async function getBookableServices(): Promise<BookableService[]> {
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
}

export async function getBookableService(serviceId: string): Promise<BookableService | null> {
  const services = await getBookableServices();
  return services.find((s) => s.id === serviceId) ?? null;
}

/** Barbieri attivi abilitati al servizio, in ordine di nome. */
export async function getBarbersForService(serviceId: string): Promise<BookableBarber[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("barber_services")
    .select("barbers!inner(id, display_name, photo_url, bio, is_active)")
    .eq("service_id", serviceId)
    .eq("barbers.is_active", true);
  if (error) console.error("getBarbersForService", error);
  return (data ?? [])
    .map(({ barbers: b }) => ({ id: b.id, name: b.display_name, photoUrl: b.photo_url, bio: b.bio }))
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
}

/** Prenotazioni del cliente (RLS: solo le proprie), con nomi di servizio e barbiere. */
export async function getMyBookings(customerId: string): Promise<MyBooking[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, status, duration_min, price_cents, notes, services(name), barbers(display_name)",
    )
    .eq("customer_id", customerId)
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) console.error("getMyBookings", error);
  return (data ?? []).map((b) => ({
    id: b.id,
    startsAt: b.starts_at,
    status: b.status,
    durationMin: b.duration_min,
    priceCents: b.price_cents,
    notes: b.notes,
    serviceName: b.services?.name ?? "",
    barberName: b.barbers?.display_name ?? "",
  }));
}

/** Prima prenotazione confermata non ancora iniziata. */
export async function getNextBooking(customerId: string): Promise<MyBooking | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, status, duration_min, price_cents, notes, services(name), barbers(display_name)",
    )
    .eq("customer_id", customerId)
    .eq("status", "confirmed")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(1)
    .maybeSingle();
  if (error) console.error("getNextBooking", error);
  if (!data) return null;
  return {
    id: data.id,
    startsAt: data.starts_at,
    status: data.status,
    durationMin: data.duration_min,
    priceCents: data.price_cents,
    notes: data.notes,
    serviceName: data.services?.name ?? "",
    barberName: data.barbers?.display_name ?? "",
  };
}

/** Il cliente è bloccato per la prenotazione online? Legge i soli campi del proprio profilo. */
export async function getBookingProfile(
  customerId: string,
): Promise<{ isBlocked: boolean; noShowCount: number } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("is_blocked, no_show_count")
    .eq("id", customerId)
    .maybeSingle();
  if (error) console.error("getBookingProfile", error);
  return data ? { isBlocked: data.is_blocked, noShowCount: data.no_show_count } : null;
}
