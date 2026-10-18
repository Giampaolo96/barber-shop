import "server-only";

// Disponibilità lato server (SPEC §4, ADR 004): dati da `availability_inputs` con il client della
// richiesta (anon o utente, mai la service_role), calcolo nel motore puro, in uscita solo orari.
import { z } from "zod";
import {
  availableDays,
  computeSlots,
  computeSlotsByBarber,
  dayStatuses,
  firstFree,
  nextSlotByBarber,
  type AvailabilityInput,
  type BarberAvailabilityInput,
  type DayStatus,
} from "@/lib/availability";
import { getCurrentUser } from "@/lib/auth/current-user";
import { addDays, isValidLocalDate, localDateOf, startOfLocalDay } from "@/lib/domain/local-time";
import { createClient } from "@/lib/db/server";
import { initialDay, recentBarberId } from "./when";

export type SlotsResult = { ok: true; slots: string[] } | { ok: false; error: "invalid" | "error" };
export type DaysResult = { ok: true; days: string[] } | { ok: false; error: "invalid" | "error" };

/** Periodo massimo di getAvailableDays (decisione fetta 4). */
const MAX_DAYS_SPAN = 366;

const localDate = z.string().refine(isValidLocalDate);
const barberChoice = z.union([z.uuid(), z.literal("any")]);

const slotsSchema = z.object({ serviceId: z.uuid(), barberId: barberChoice, date: localDate });

const daysSchema = z
  .object({ serviceId: z.uuid(), barberId: barberChoice, from: localDate, to: localDate })
  .refine(({ from, to }) => from <= to && addDays(from, MAX_DAYS_SPAN - 1) >= to);

/**
 * input null: servizio inesistente o non visibile, nessun orario. `today` e `lastDay`: oggi e
 * ultimo giorno prenotabile (oggi + max_horizon_days), giorni locali del negozio.
 */
type Loaded =
  | { ok: true; input: AvailabilityInput | null; today: string; lastDay: string }
  | { ok: false };

/**
 * Un solo caricamento per tutto il periodo: impostazioni, servizio e availability_inputs.
 * `fromDate` null: da oggi; `toDate` null: fino all'ultimo giorno prenotabile. Con un periodo
 * vuoto non si legge nulla e input è null.
 */
async function loadInput(
  serviceId: string,
  barberId: string,
  fromDate: string | null,
  toDate: string | null,
): Promise<Loaded> {
  const supabase = await createClient();

  const settingsResult = await supabase
    .from("shop_settings")
    .select("timezone, slot_granularity_min, min_advance_min, max_horizon_days, buffer_min")
    .maybeSingle();
  if (settingsResult.error || !settingsResult.data) return { ok: false };
  const settings = settingsResult.data;
  const tz = settings.timezone;
  const now = new Date();
  const today = localDateOf(now, tz);
  const lastDay = addDays(today, settings.max_horizon_days);
  const from = fromDate ?? today;
  const to = toDate ?? lastDay;
  if (from > to) return { ok: true, input: null, today, lastDay };

  const [serviceResult, rowsResult] = await Promise.all([
    supabase.from("services").select("duration_min").eq("id", serviceId).maybeSingle(),
    supabase.rpc("availability_inputs", {
      p_service_id: serviceId,
      p_barber_id: barberId === "any" ? null : barberId,
      p_from: startOfLocalDay(from, tz).toISOString(),
      p_to: startOfLocalDay(addDays(to, 1), tz).toISOString(),
    }),
  ]);
  if (serviceResult.error || rowsResult.error) return { ok: false };
  if (!serviceResult.data) return { ok: true, input: null, today, lastDay };

  const barbers = new Map<string, BarberAvailabilityInput>();
  const closures: AvailabilityInput["closures"] = [];
  for (const row of rowsResult.data ?? []) {
    const interval = { start: new Date(row.starts_at), end: new Date(row.ends_at) };
    if (row.kind === "closure") {
      closures.push(interval);
      continue;
    }
    if (!row.barber_id) continue;
    let barber = barbers.get(row.barber_id);
    if (!barber) {
      barber = { barberId: row.barber_id, work: [], timeOff: [], busy: [] };
      barbers.set(row.barber_id, barber);
    }
    if (row.kind === "work") barber.work.push(interval);
    else if (row.kind === "time_off") barber.timeOff.push(interval);
    else if (row.kind === "busy") barber.busy.push(interval);
  }

  return {
    ok: true,
    today,
    lastDay,
    input: {
      timezone: tz,
      now,
      settings: {
        slotGranularityMin: settings.slot_granularity_min,
        minAdvanceMin: settings.min_advance_min,
        maxHorizonDays: settings.max_horizon_days,
        bufferMin: settings.buffer_min,
      },
      serviceDurationMin: serviceResult.data.duration_min,
      closures,
      barbers: [...barbers.values()],
    },
  };
}

/** Orari prenotabili nel giorno locale `date` (YYYY-MM-DD), come istanti ISO UTC. */
export async function getAvailableSlots(args: {
  serviceId: string;
  barberId: string;
  date: string;
}): Promise<SlotsResult> {
  const parsed = slotsSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { serviceId, barberId, date } = parsed.data;

  try {
    const loaded = await loadInput(serviceId, barberId, date, date);
    if (!loaded.ok) return { ok: false, error: "error" };
    if (!loaded.input) return { ok: true, slots: [] };
    return { ok: true, slots: computeSlots(loaded.input, date).map((d) => d.toISOString()) };
  } catch (error) {
    console.error("getAvailableSlots", error);
    return { ok: false, error: "error" };
  }
}

/** Giorni locali in [from, to] (inclusi, al massimo 366) con almeno un orario prenotabile. */
export async function getAvailableDays(args: {
  serviceId: string;
  barberId: string;
  from: string;
  to: string;
}): Promise<DaysResult> {
  const parsed = daysSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { serviceId, barberId, from, to } = parsed.data;

  try {
    const loaded = await loadInput(serviceId, barberId, from, to);
    if (!loaded.ok) return { ok: false, error: "error" };
    if (!loaded.input) return { ok: true, days: [] };
    return { ok: true, days: availableDays(loaded.input, from, to) };
  } catch (error) {
    console.error("getAvailableDays", error);
    return { ok: false, error: "error" };
  }
}

// ---------------------------------------------------------------------------
// "Quando?" (SPEC §5.2, fetta 8e): tutti i barbieri del servizio insieme, in uscita solo orari e id.
// ---------------------------------------------------------------------------

/** Orari di un barbiere nel giorno; `next` = primo orario nei giorni dopo, solo se il giorno è pieno. */
export type WhenBarberDay = { barberId: string; slots: string[]; next: string | null };

export type WhenDay = {
  date: string;
  firstFree: { barberId: string; startsAt: string } | null;
  barbers: WhenBarberDay[];
};

export type WhenDayResult = ({ ok: true } & WhenDay) | { ok: false; error: "invalid" | "error" };

export type WhenOverview =
  | {
      ok: true;
      /** Stato di ogni giorno da oggi all'ultimo giorno prenotabile. */
      days: DayStatus[];
      /** Giorno mostrato all'apertura; null se nel periodo non c'è nessun orario (stato vuoto). */
      day: WhenDay | null;
      /** Barbiere dell'ultimo appuntamento del cliente (ordine delle sezioni). */
      recentId: string | null;
    }
  | { ok: false };

const whenDaySchema = z.object({
  serviceId: z.uuid(),
  date: localDate,
  barberId: z.uuid().optional(),
  recentBarberId: z.uuid().optional(),
});

/**
 * Barbiere dell'ultimo appuntamento già iniziato del cliente in sessione (RLS: solo le proprie
 * prenotazioni); null per anonimi e staff o se la lettura non riesce. Le cancellate si escludono
 * nella query, così un appuntamento valido non si perde dietro molte cancellazioni.
 */
async function loadRecentBarberId(now: Date): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user || user.role !== "customer") return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("barber_id, starts_at, status")
    .eq("customer_id", user.id)
    .lt("starts_at", now.toISOString())
    .not("status", "in", "(cancelled_by_customer,cancelled_by_shop)")
    .order("starts_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("loadRecentBarberId", error);
    return null;
  }
  return recentBarberId(
    (data ?? []).map((b) => ({ barberId: b.barber_id, startsAt: b.starts_at, status: b.status })),
    now,
  );
}

/** Orari del giorno per barbiere, "Primo libero" e prossimo orario dei barbieri pieni. */
function whenDayOf(input: AvailabilityInput, date: string, lastDay: string, preferred: string[]): WhenDay {
  const slotsByBarber = computeSlotsByBarber(input, date);
  const full = input.barbers.filter((b) => (slotsByBarber[b.barberId] ?? []).length === 0);
  const next = full.length > 0 ? nextSlotByBarber({ ...input, barbers: full }, date, lastDay) : {};
  const first = firstFree(input, date, preferred);
  return {
    date,
    firstFree: first ? { barberId: first.barberId, startsAt: first.startsAt.toISOString() } : null,
    barbers: input.barbers.map((b) => ({
      barberId: b.barberId,
      slots: (slotsByBarber[b.barberId] ?? []).map((d) => d.toISOString()),
      next: next[b.barberId]?.toISOString() ?? null,
    })),
  };
}

/**
 * Apertura di "Quando?": una lettura dell'intero periodo prenotabile per la striscia dei giorni,
 * il giorno iniziale (quello richiesto se non chiuso, altrimenti il primo con orari) e i suoi orari.
 */
export async function getWhenOverview(args: {
  serviceId: string;
  requestedDay?: string;
  barberId?: string;
}): Promise<WhenOverview> {
  try {
    const [loaded, recentId] = await Promise.all([
      loadInput(args.serviceId, "any", null, null),
      loadRecentBarberId(new Date()),
    ]);
    if (!loaded.ok) return { ok: false };
    if (!loaded.input) return { ok: true, days: [], day: null, recentId };
    const days = dayStatuses(loaded.input, loaded.today, loaded.lastDay);
    const date = initialDay(days, args.requestedDay);
    const preferred = [args.barberId, recentId].filter((id): id is string => !!id);
    return {
      ok: true,
      days,
      day: date ? whenDayOf(loaded.input, date, loaded.lastDay, preferred) : null,
      recentId,
    };
  } catch (error) {
    console.error("getWhenOverview", error);
    return { ok: false };
  }
}

/**
 * Cambio di giorno in "Quando?": una lettura dal giorno scelto all'ultimo giorno prenotabile (serve
 * per il prossimo orario dei barbieri pieni). Giorno fuori dal periodo prenotabile: invalid.
 * `recentBarberId`: barbiere dell'ultimo appuntamento, calcolato all'apertura da getWhenOverview e
 * rimandato dal client (è un dato del cliente stesso; conta solo come precedenza nel "Primo libero").
 */
export async function getWhenDay(args: {
  serviceId: string;
  date: string;
  barberId?: string;
  recentBarberId?: string;
}): Promise<WhenDayResult> {
  const parsed = whenDaySchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { serviceId, date, barberId, recentBarberId: recentId } = parsed.data;

  try {
    const loaded = await loadInput(serviceId, "any", date, null);
    if (!loaded.ok) return { ok: false, error: "error" };
    if (date < loaded.today || date > loaded.lastDay) return { ok: false, error: "invalid" };
    if (!loaded.input) return { ok: true, date, firstFree: null, barbers: [] };
    const preferred = [barberId, recentId].filter((id): id is string => !!id);
    return { ok: true, ...whenDayOf(loaded.input, date, loaded.lastDay, preferred) };
  } catch (error) {
    console.error("getWhenDay", error);
    return { ok: false, error: "error" };
  }
}
