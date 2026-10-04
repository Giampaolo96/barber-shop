import "server-only";

// Disponibilità lato server (SPEC §4, ADR 004): dati da `availability_inputs` con il client della
// richiesta (anon o utente, mai la service_role), calcolo nel motore puro, in uscita solo orari.
import { z } from "zod";
import {
  availableDays,
  computeSlots,
  type AvailabilityInput,
  type BarberAvailabilityInput,
} from "@/lib/availability";
import { addDays, isValidLocalDate, startOfLocalDay } from "@/lib/domain/local-time";
import { createClient } from "@/lib/db/server";

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

/** input null: servizio inesistente o non visibile, nessun orario. */
type Loaded = { ok: true; input: AvailabilityInput | null } | { ok: false };

/** Un solo caricamento per tutto il periodo: impostazioni, servizio e availability_inputs. */
async function loadInput(
  serviceId: string,
  barberId: string,
  fromDate: string,
  toDate: string,
): Promise<Loaded> {
  const supabase = await createClient();

  const settingsResult = await supabase
    .from("shop_settings")
    .select("timezone, slot_granularity_min, min_advance_min, max_horizon_days, buffer_min")
    .maybeSingle();
  if (settingsResult.error || !settingsResult.data) return { ok: false };
  const settings = settingsResult.data;
  const tz = settings.timezone;

  const [serviceResult, rowsResult] = await Promise.all([
    supabase.from("services").select("duration_min").eq("id", serviceId).maybeSingle(),
    supabase.rpc("availability_inputs", {
      p_service_id: serviceId,
      p_barber_id: barberId === "any" ? null : barberId,
      p_from: startOfLocalDay(fromDate, tz).toISOString(),
      p_to: startOfLocalDay(addDays(toDate, 1), tz).toISOString(),
    }),
  ]);
  if (serviceResult.error || rowsResult.error) return { ok: false };
  if (!serviceResult.data) return { ok: true, input: null };

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
    input: {
      timezone: tz,
      now: new Date(),
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
