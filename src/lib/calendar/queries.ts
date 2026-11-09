import "server-only";

// Letture del calendario dello staff (SPEC §6.1–6.3), sempre con il client della richiesta: la RLS
// limita il barbiere alle proprie prenotazioni e assenze e ai profili dei propri clienti.
import type { createClient } from "@/lib/db/server";
import { localDateOf } from "@/lib/domain/local-time";
import { type Interval, isoWeekday, type LocalBand, localBandsToIntervals } from "./grid";
import type { BookingStatus } from "./transitions";
import { manualBookingWarnings, type WarningCode } from "./warnings";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type CalendarSettings = { timezone: string; granularityMin: number };

export type CalendarBarber = { id: string; displayName: string; isActive: boolean };

export type CalendarBooking = Interval & {
  id: string;
  /** Fine del buffer dopo l'appuntamento: fino a qui il barbiere è occupato. */
  blockedUntil: Date;
  barberId: string;
  status: BookingStatus;
  serviceName: string;
  customerName: string;
};

export type CalendarPeriod = Interval & { barberId: string | null; reason: string | null };

export type BookingDetail = Interval & {
  id: string;
  barberId: string;
  barberName: string;
  serviceId: string;
  serviceName: string;
  status: BookingStatus;
  source: string;
  durationMin: number;
  priceCents: number;
  customerNote: string | null;
  customerName: string;
  customerPhone: string | null;
  isGuest: boolean;
  staffNote: string | null;
};

export type CatalogService = { id: string; name: string; durationMin: number; isActive: boolean };

const fail = (what: string, error: { code?: string; message?: string } | null): never => {
  throw new Error(`${what} non leggibili: ${error?.code ?? ""} ${error?.message ?? ""}`.trim());
};

export async function getCalendarSettings(supabase: ServerClient): Promise<CalendarSettings> {
  const { data, error } = await supabase
    .from("shop_settings")
    .select("timezone, slot_granularity_min")
    .single();
  if (error || !data) return fail("impostazioni", error);
  return { timezone: data.timezone, granularityMin: data.slot_granularity_min };
}

/** Tutte le schede, in ordine di nome (barbers ha grant di colonna: colonne esplicite). */
export async function getBarbers(supabase: ServerClient): Promise<CalendarBarber[]> {
  const { data, error } = await supabase
    .from("barbers")
    .select("id, display_name, is_active")
    .order("display_name");
  if (error || !data) return fail("barbieri", error);
  return data.map((row) => ({ id: row.id, displayName: row.display_name, isActive: row.is_active }));
}

/** Servizi del catalogo (lo staff li legge tutti, anche disattivati), nell'ordine del catalogo. */
export async function getServices(supabase: ServerClient): Promise<CatalogService[]> {
  const { data, error } = await supabase
    .from("services")
    .select("id, name, duration_min, is_active")
    .order("sort_order")
    .order("name");
  if (error || !data) return fail("servizi", error);
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    durationMin: row.duration_min,
    isActive: row.is_active,
  }));
}

const BOOKING_COLUMNS =
  "id, barber_id, starts_at, ends_at, blocked_until, status, guest_name, service:services(name), customer:profiles!bookings_customer_id_fkey(full_name)";

/** Prenotazioni lette al massimo per una vista (max_rows di PostgREST): oltre, la vista è incompleta. */
export const CALENDAR_BOOKINGS_LIMIT = 1000;

/**
 * Prenotazioni dei barbieri che si sovrappongono a `[from, to)`, in ordine di inizio. `incomplete`:
 * nel database ce ne sono più di CALENDAR_BOOKINGS_LIMIT, o il conteggio manca (nel dubbio si avvisa).
 */
export async function getBookingsInRange(
  supabase: ServerClient,
  barberIds: string[],
  from: Date,
  to: Date,
): Promise<{ bookings: CalendarBooking[]; incomplete: boolean }> {
  if (barberIds.length === 0) return { bookings: [], incomplete: false };
  const { data, error, count } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS, { count: "exact" })
    .in("barber_id", barberIds)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString())
    .order("starts_at")
    .limit(CALENDAR_BOOKINGS_LIMIT);
  if (error || !data) return fail("prenotazioni", error);
  const bookings = data.map((row) => ({
    id: row.id,
    barberId: row.barber_id,
    status: row.status,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    blockedUntil: new Date(row.blocked_until),
    serviceName: row.service?.name ?? "",
    // Un cliente che ha eliminato l'account resta senza nome (anonimizzazione, SPEC §8).
    customerName: row.guest_name ?? row.customer?.full_name ?? "",
  }));
  return { bookings, incomplete: count === null || count > CALENDAR_BOOKINGS_LIMIT };
}

/** Fasce settimanali per barbiere e giorno ISO (1 = lunedì). */
export async function getWorkingBands(
  supabase: ServerClient,
  barberIds: string[],
): Promise<Map<string, Map<number, LocalBand[]>>> {
  const bands = new Map<string, Map<number, LocalBand[]>>();
  if (barberIds.length === 0) return bands;
  const { data, error } = await supabase
    .from("working_hours")
    .select("barber_id, weekday, start_time, end_time")
    .in("barber_id", barberIds)
    .order("start_time");
  if (error || !data) return fail("orari", error);
  for (const row of data) {
    const byDay = bands.get(row.barber_id) ?? new Map<number, LocalBand[]>();
    byDay.set(row.weekday, [...(byDay.get(row.weekday) ?? []), { start: row.start_time, end: row.end_time }]);
    bands.set(row.barber_id, byDay);
  }
  return bands;
}

/**
 * Giorni ISO in cui il negozio ha orari di apertura, dalla stessa fonte degli orari della home
 * (shop_opening_hours: unione delle fasce dei barbieri attivi).
 */
export async function getOpenWeekdays(supabase: ServerClient): Promise<number[]> {
  const { data, error } = await supabase.rpc("shop_opening_hours");
  if (error || !data) return fail("orari del negozio", error);
  return [...new Set(data.map((row) => row.weekday))];
}

/** Fasce di un barbiere nel giorno locale `date`. */
export const bandsOn = (
  bands: Map<string, Map<number, LocalBand[]>>,
  barberId: string,
  date: string,
): LocalBand[] => bands.get(barberId)?.get(isoWeekday(date)) ?? [];

/** Assenze dei barbieri che si sovrappongono a `[from, to)`. */
export async function getTimeOff(
  supabase: ServerClient,
  barberIds: string[],
  from: Date,
  to: Date,
): Promise<CalendarPeriod[]> {
  if (barberIds.length === 0) return [];
  const { data, error } = await supabase
    .from("time_off")
    .select("barber_id, starts_at, ends_at, reason")
    .in("barber_id", barberIds)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString());
  if (error || !data) return fail("assenze", error);
  return data.map((row) => ({
    barberId: row.barber_id,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    reason: row.reason,
  }));
}

/** Chiusure del negozio che si sovrappongono a `[from, to)`. */
export async function getClosures(supabase: ServerClient, from: Date, to: Date): Promise<CalendarPeriod[]> {
  const { data, error } = await supabase
    .from("shop_closures")
    .select("starts_at, ends_at, reason")
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString());
  if (error || !data) return fail("chiusure", error);
  return data.map((row) => ({
    barberId: null,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    reason: row.reason,
  }));
}

/** Avvisi (SPEC §3.7.5) per `[startsAt, endsAt)` del barbiere, calcolati sui dati attuali. */
export async function slotWarnings(
  supabase: ServerClient,
  input: Interval & { barberId: string; timezone: string; now: Date },
): Promise<WarningCode[]> {
  const date = localDateOf(input.startsAt, input.timezone);
  const [bands, timeOff, closures] = await Promise.all([
    getWorkingBands(supabase, [input.barberId]),
    getTimeOff(supabase, [input.barberId], input.startsAt, input.endsAt),
    getClosures(supabase, input.startsAt, input.endsAt),
  ]);
  return manualBookingWarnings({
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    now: input.now,
    bands: localBandsToIntervals(date, bandsOn(bands, input.barberId, date), input.timezone),
    timeOff,
    closures,
  });
}

const DETAIL_COLUMNS =
  "id, barber_id, service_id, starts_at, ends_at, status, source, duration_min, price_cents, notes, guest_name, guest_phone, customer_id, barber:barbers(display_name), service:services(name), customer:profiles!bookings_customer_id_fkey(full_name, phone), staff_note:booking_staff_notes(note)";

/** Dettaglio di una prenotazione visibile all'utente; null se non esiste o non è sua (RLS). */
export async function getBookingDetail(supabase: ServerClient, id: string): Promise<BookingDetail | null> {
  const { data, error } = await supabase.from("bookings").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  if (error) return fail("prenotazione", error);
  if (!data) return null;
  return {
    id: data.id,
    barberId: data.barber_id,
    barberName: data.barber?.display_name ?? "",
    serviceId: data.service_id,
    serviceName: data.service?.name ?? "",
    status: data.status,
    source: data.source,
    startsAt: new Date(data.starts_at),
    endsAt: new Date(data.ends_at),
    durationMin: data.duration_min,
    priceCents: data.price_cents,
    customerNote: data.notes,
    customerName: data.guest_name ?? data.customer?.full_name ?? "",
    customerPhone: data.guest_phone ?? data.customer?.phone ?? null,
    isGuest: data.customer_id === null && data.guest_name !== null,
    staffNote: data.staff_note?.note ?? null,
  };
}
