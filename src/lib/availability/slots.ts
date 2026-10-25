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

/** Stato di un giorno nella striscia di "Quando?" (SPEC §5.2, fetta 8e). */
export type DayStatus = { date: string; status: "closed" | "full" | "open" };

/**
 * Stato di ogni giorno locale in [from, to] (inclusi). "closed": nessun barbiere ha tempo di lavoro
 * al netto di chiusure e assenze (indipendente da prenotazioni e da `now`); "open": almeno uno slot;
 * altrimenti "full".
 */
export function dayStatuses(input: AvailabilityInput, from: string, to: string): DayStatus[] {
  const p = prepare(input);
  const tz = input.timezone;
  const days: DayStatus[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const dayStart = startOfLocalDay(date, tz).getTime();
    const dayEnd = startOfLocalDay(addDays(date, 1), tz).getTime();
    const works = p.barbers.some((b) =>
      b.free.some((f) => f.start.getTime() < dayEnd && dayStart < f.end.getTime()),
    );
    const status = !works
      ? "closed"
      : p.barbers.some((b) => barberSlots(p, b, date, true).length > 0)
        ? "open"
        : "full";
    days.push({ date, status });
  }
  return days;
}

/**
 * Primo slot di ogni barbiere nei giorni locali dopo `afterDate` fino a `to` incluso ("prossimo
 * orario libero" di "Quando?"); null se non ce n'è. Una chiave per ogni barbiere in input.
 */
export function nextSlotByBarber(
  input: AvailabilityInput,
  afterDate: string,
  to: string,
): Record<string, Date | null> {
  const p = prepare(input);
  return Object.fromEntries(
    p.barbers.map((b) => {
      for (let date = addDays(afterDate, 1); date <= to; date = addDays(date, 1)) {
        const [first] = barberSlots(p, b, date, true);
        if (first) return [b.barberId, first];
      }
      return [b.barberId, null];
    }),
  );
}

/** Orari di un barbiere in un giorno di slotsByDay; `next` solo se quel giorno non ne ha. */
export type BarberDaySlots = { barberId: string; slots: Date[]; next: Date | null };

/**
 * Orari di ogni barbiere in ogni giorno locale di [from, to] (inclusi, anche i giorni chiusi, vuoti),
 * da una sola preparazione dell'input ("Quando?", fetta 8g). Per ogni giorno un elemento per barbiere,
 * nell'ordine dell'input. `next` = primo orario nei giorni dopo fino a `to` incluso, solo per i barbieri
 * senza orari quel giorno (come nextSlotByBarber).
 */
export function slotsByDay(input: AvailabilityInput, from: string, to: string): Record<string, BarberDaySlots[]> {
  const p = prepare(input);
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  const slots = dates.map((date) => p.barbers.map((b) => barberSlots(p, b, date)));

  const result: Record<string, BarberDaySlots[]> = {};
  // Dall'ultimo giorno indietro: per ogni barbiere il primo orario dei giorni già visti.
  const upcoming: Array<Date | null> = p.barbers.map(() => null);
  for (let d = dates.length - 1; d >= 0; d--) {
    const day = slots[d] ?? [];
    result[dates[d] ?? ""] = p.barbers.map((b, i) => {
      const own = day[i] ?? [];
      return { barberId: b.barberId, slots: own, next: own.length === 0 ? upcoming[i] ?? null : null };
    });
    day.forEach((own, i) => {
      if (own[0]) upcoming[i] = own[0];
    });
  }
  // Chiavi nell'ordine dei giorni.
  return Object.fromEntries(dates.map((date) => [date, result[date] ?? []]));
}
