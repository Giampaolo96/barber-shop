import "server-only";

// Disponibilità lato server (SPEC §4, ADR 004): dati da `availability_inputs_json` (un solo jsonb,
// niente taglio a max_rows: ADR 015) con il client della richiesta (anon o utente, mai la
// service_role), calcolo nel motore puro, in uscita solo orari.
import { z } from "zod";
import {
  dayStatuses,
  slotsByDay,
  type AvailabilityInput,
  type BarberAvailabilityInput,
  type DayStatus,
} from "@/lib/availability";
import { getCurrentUser } from "@/lib/auth/current-user";
import { addDays, isValidLocalDate, localDateOf, startOfLocalDay } from "@/lib/domain/local-time";
import { createClient } from "@/lib/db/server";
import { getShopInfo } from "./queries";
import { initialDay, recentBarberId } from "./when";

/** Righe di availability_inputs_json: intervalli senza dati di clienti o prenotazioni. */
const inputRowsSchema = z.array(
  z.object({
    kind: z.enum(["work", "time_off", "closure", "busy"]),
    barber_id: z.string().nullable(),
    starts_at: z.string(),
    ends_at: z.string(),
  }),
);

/**
 * input null: servizio inesistente o non visibile, nessun orario. `today` e `lastDay`: oggi e
 * ultimo giorno prenotabile (oggi + max_horizon_days), giorni locali del negozio.
 */
type Loaded =
  | { ok: true; input: AvailabilityInput | null; today: string; lastDay: string }
  | { ok: false };

/**
 * Un solo caricamento per tutto il periodo: impostazioni (getShopInfo), servizio e availability_inputs_json.
 * Da `fromDate` (null: da oggi) all'ultimo giorno prenotabile, per tutti i barbieri del servizio. Con
 * un periodo vuoto non si legge nulla e input è null.
 */
async function loadInput(serviceId: string, fromDate: string | null): Promise<Loaded> {
  const supabase = await createClient();

  // Le stesse impostazioni di layout e pagina: con cache() una sola lettura per richiesta.
  const settings = await getShopInfo();
  if (!settings) return { ok: false };
  const tz = settings.timezone;
  const now = new Date();
  const today = localDateOf(now, tz);
  const lastDay = addDays(today, settings.maxHorizonDays);
  const from = fromDate ?? today;
  if (from > lastDay) return { ok: true, input: null, today, lastDay };

  const [serviceResult, rowsResult] = await Promise.all([
    supabase.from("services").select("duration_min").eq("id", serviceId).maybeSingle(),
    supabase.rpc("availability_inputs_json", {
      p_service_id: serviceId,
      p_barber_id: null,
      p_from: startOfLocalDay(from, tz).toISOString(),
      p_to: startOfLocalDay(addDays(lastDay, 1), tz).toISOString(),
    }),
  ]);
  if (serviceResult.error || rowsResult.error) return { ok: false };
  if (!serviceResult.data) return { ok: true, input: null, today, lastDay };
  const rows = inputRowsSchema.safeParse(rowsResult.data);
  if (!rows.success) return { ok: false };

  const barbers = new Map<string, BarberAvailabilityInput>();
  const closures: AvailabilityInput["closures"] = [];
  for (const row of rows.data) {
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
        slotGranularityMin: settings.slotGranularityMin,
        minAdvanceMin: settings.minAdvanceMin,
        maxHorizonDays: settings.maxHorizonDays,
        bufferMin: settings.bufferMin,
      },
      serviceDurationMin: serviceResult.data.duration_min,
      closures,
      barbers: [...barbers.values()],
    },
  };
}

// ---------------------------------------------------------------------------
// "Quando?" (SPEC §5.2, fette 8e e 8g): tutti i barbieri del servizio insieme, in uscita solo orari e id.
// ---------------------------------------------------------------------------

/** Orari di un barbiere nel giorno; `next` = primo orario nei giorni dopo, solo se il giorno è pieno. */
export type WhenBarberDay = { barberId: string; slots: string[]; next: string | null };

export type WhenDay = { date: string; barbers: WhenBarberDay[] };

export type WhenDaysResult = { ok: true; days: WhenDay[] } | { ok: false; error: "invalid" | "error" };

export type WhenOverview =
  | {
      ok: true;
      /** Stato di ogni giorno da oggi all'ultimo giorno prenotabile. */
      days: DayStatus[];
      /** Giorno mostrato all'apertura; null se nel periodo non c'è nessun orario (stato vuoto). */
      initialDay: string | null;
      /** Orari di ogni giorno della fila (i giorni non chiusi), in ordine (fetta 8g). */
      whenDays: WhenDay[];
      /** Barbiere dell'ultimo appuntamento del cliente (ordine delle colonne). */
      recentId: string | null;
    }
  | { ok: false };

const localDate = z.string().refine(isValidLocalDate);

const whenDaysSchema = z
  .object({ serviceId: z.uuid(), from: localDate, to: localDate })
  .refine(({ from, to }) => from <= to);

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

/**
 * Orari per barbiere dei giorni `dates` (tutti in [from, lastDay]), con il prossimo orario dei barbieri
 * pieni fino all'ultimo giorno prenotabile: un solo passaggio del motore su [from, lastDay].
 */
function whenDaysOf(input: AvailabilityInput, dates: string[], from: string, lastDay: string): WhenDay[] {
  const byDay = slotsByDay(input, from, lastDay);
  return dates.map((date) => ({
    date,
    barbers: (byDay[date] ?? []).map((b) => ({
      barberId: b.barberId,
      slots: b.slots.map((d) => d.toISOString()),
      next: b.next?.toISOString() ?? null,
    })),
  }));
}

const notClosed = (days: DayStatus[]): string[] => days.filter((d) => d.status !== "closed").map((d) => d.date);

/**
 * Apertura di "Quando?": una lettura dell'intero periodo prenotabile per la striscia dei giorni, il
 * giorno iniziale (quello richiesto se non chiuso, altrimenti il primo con orari) e gli orari di tutti
 * i giorni della fila (fetta 8g: scorrendo non parte nessuna richiesta).
 */
export async function getWhenOverview(args: { serviceId: string; requestedDay?: string }): Promise<WhenOverview> {
  try {
    const [loaded, recentId] = await Promise.all([
      loadInput(args.serviceId, null),
      loadRecentBarberId(new Date()),
    ]);
    if (!loaded.ok) return { ok: false };
    if (!loaded.input) return { ok: true, days: [], initialDay: null, whenDays: [], recentId };
    const days = dayStatuses(loaded.input, loaded.today, loaded.lastDay);
    const date = initialDay(days, args.requestedDay);
    return {
      ok: true,
      days,
      initialDay: date,
      whenDays: date ? whenDaysOf(loaded.input, notClosed(days), loaded.today, loaded.lastDay) : [],
      recentId,
    };
  } catch (error) {
    console.error("getWhenOverview", error);
    return { ok: false };
  }
}

/**
 * Orari dei giorni non chiusi in [from, to] (ricarica in background e nuovo tentativo di "Quando?", fetta 8g): una
 * lettura da `from` all'ultimo giorno prenotabile, per il prossimo orario dei barbieri pieni. Un
 * periodo fuori da quello prenotabile è invalid, senza leggere gli orari.
 */
export async function getWhenDays(args: { serviceId: string; from: string; to: string }): Promise<WhenDaysResult> {
  const parsed = whenDaysSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { serviceId, from, to } = parsed.data;

  try {
    const shop = await getShopInfo();
    if (!shop) return { ok: false, error: "error" };
    const today = localDateOf(new Date(), shop.timezone);
    if (from < today || to > addDays(today, shop.maxHorizonDays)) return { ok: false, error: "invalid" };

    const loaded = await loadInput(serviceId, from);
    if (!loaded.ok) return { ok: false, error: "error" };
    if (!loaded.input) return { ok: true, days: [] };
    const dates = notClosed(dayStatuses(loaded.input, from, to));
    return { ok: true, days: whenDaysOf(loaded.input, dates, from, loaded.lastDay) };
  } catch (error) {
    console.error("getWhenDays", error);
    return { ok: false, error: "error" };
  }
}
