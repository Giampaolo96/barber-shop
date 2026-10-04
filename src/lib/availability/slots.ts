// Calcolo degli orari prenotabili (SPEC §4, ADR 004). Le fasce di lavoro arrivano già come
// istanti concreti; qui contano solo i giorni locali del negozio e la griglia dell'orologio locale.
import { getTimezoneOffset } from "date-fns-tz";
import { addDays, localDateOf, startOfLocalDay } from "@/lib/domain/local-time";
import { SLOT_GRANULARITY_OPTIONS } from "@/lib/domain/settings";
import { mergeIntervals, subtractIntervals, type Interval } from "./intervals";

export type BarberAvailabilityInput = {
  barberId: string;
  /** Fasce di lavoro già convertite in istanti concreti. */
  work: Interval[];
  timeOff: Interval[];
  /** Prenotazioni confirmed: [starts_at, blocked_until), buffer copiato incluso. */
  busy: Interval[];
};

export type AvailabilityInput = {
  timezone: string;
  now: Date;
  settings: {
    slotGranularityMin: number;
    minAdvanceMin: number;
    maxHorizonDays: number;
    /** buffer_min corrente: vale solo per il nuovo slot. */
    bufferMin: number;
  };
  serviceDurationMin: number;
  closures: Interval[];
  barbers: BarberAvailabilityInput[];
};

const MINUTE = 60_000;

/**
 * Primo istante ≥ `ms`, al minuto intero, i cui minuti locali dalla mezzanotte sono multipli di
 * `step`. Le granularità ammesse dividono 60, quindi basta l'offset del momento.
 */
function nextAligned(ms: number, step: number, tz: string): number {
  let t = Math.ceil(ms / MINUTE) * MINUTE;
  for (let attempt = 0; attempt < 3; attempt++) {
    const localMinutes = (t + getTimezoneOffset(tz, new Date(t))) / MINUTE;
    const rest = ((localMinutes % step) + step) % step;
    if (rest === 0) break;
    t += (step - rest) * MINUTE;
  }
  return t;
}

type PreparedBarber = { barberId: string; free: Interval[]; busy: Interval[] };

type Prepared = {
  input: AvailabilityInput;
  barbers: PreparedBarber[];
  earliestStart: number;
  horizonEnd: number;
};

function validate(input: AvailabilityInput): void {
  const step = input.settings.slotGranularityMin;
  if (!(SLOT_GRANULARITY_OPTIONS as readonly number[]).includes(step)) {
    throw new Error(`granularità non ammessa: ${step}`);
  }
  if (!Number.isInteger(input.serviceDurationMin) || input.serviceDurationMin <= 0) {
    throw new Error(`durata del servizio non valida: ${input.serviceDurationMin}`);
  }
}

/** Fasce libere per barbiere (lavoro meno assenze e chiusure), calcolate una volta sola. */
function prepare(input: AvailabilityInput): Prepared {
  validate(input);
  const tz = input.timezone;
  const today = localDateOf(input.now, tz);
  return {
    input,
    barbers: input.barbers.map((b) => ({
      barberId: b.barberId,
      free: subtractIntervals(b.work, [...b.timeOff, ...input.closures]),
      busy: mergeIntervals(b.busy),
    })),
    earliestStart: input.now.getTime() + input.settings.minAdvanceMin * MINUTE,
    // L'orizzonte vale per l'inizio dello slot: fino alla fine del giorno oggi + N.
    horizonEnd: startOfLocalDay(addDays(today, input.settings.maxHorizonDays + 1), tz).getTime(),
  };
}

/** Slot del barbiere nel giorno locale `date`; con `firstOnly` si ferma al primo trovato. */
function barberSlots(p: Prepared, barber: PreparedBarber, date: string, firstOnly = false): Date[] {
  const { timezone: tz, settings, serviceDurationMin } = p.input;
  const step = settings.slotGranularityMin;
  const duration = serviceDurationMin * MINUTE;
  const withBuffer = duration + settings.bufferMin * MINUTE;

  const firstStart = Math.max(startOfLocalDay(date, tz).getTime(), p.earliestStart);
  const lastStart = Math.min(startOfLocalDay(addDays(date, 1), tz).getTime(), p.horizonEnd);
  if (firstStart >= lastStart) return [];

  const slots: Date[] = [];
  for (const free of barber.free) {
    const freeEnd = free.end.getTime();
    // Fasce libere ordinate: si saltano quelle già finite e ci si ferma dopo il giorno.
    if (freeEnd <= firstStart) continue;
    if (free.start.getTime() >= lastStart) break;
    let t = nextAligned(Math.max(free.start.getTime(), firstStart), step, tz);
    // Servizio dentro la fascia libera; il buffer conta solo verso le prenotazioni successive.
    while (t < lastStart && t + duration <= freeEnd) {
      const end = t + withBuffer;
      const clash = barber.busy.some((b) => b.start.getTime() < end && t < b.end.getTime());
      if (!clash) {
        slots.push(new Date(t));
        if (firstOnly) return slots;
      }
      t = nextAligned(t + MINUTE, step, tz);
    }
  }
  return slots;
}

function unionOf(lists: Date[][]): Date[] {
  const times = new Set<number>();
  for (const list of lists) for (const d of list) times.add(d.getTime());
  return [...times].sort((a, b) => a - b).map((t) => new Date(t));
}

/** Slot di ogni barbiere nel giorno locale `date`: una chiave per ogni barbiere in input. */
export function computeSlotsByBarber(input: AvailabilityInput, date: string): Record<string, Date[]> {
  const p = prepare(input);
  return Object.fromEntries(p.barbers.map((b) => [b.barberId, barberSlots(p, b, date)]));
}

/** Unione degli slot di tutti i barbieri ("qualsiasi"), ordinata e senza duplicati. */
export function computeSlots(input: AvailabilityInput, date: string): Date[] {
  const p = prepare(input);
  return unionOf(p.barbers.map((b) => barberSlots(p, b, date)));
}

/** Giorni locali in [from, to] (inclusi) con almeno uno slot. */
export function availableDays(input: AvailabilityInput, from: string, to: string): string[] {
  const p = prepare(input);
  const days: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (p.barbers.some((b) => barberSlots(p, b, date, true).length > 0)) days.push(date);
  }
  return days;
}
