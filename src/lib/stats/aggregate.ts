import { addDays, endOfMonth, maxDay, minDay, startOfWeek } from "./dates";

// Statistiche dell'admin (SPEC §6.9, ADR 010): dai gruppi di admin_booking_stats a totali,
// andamento e righe per barbiere e per servizio. Logica pura: nessun I/O, nessun orologio.

/** Stati di booking_status (enum Postgres). */
export const BOOKING_STATUSES = [
  "confirmed",
  "completed",
  "cancelled_by_customer",
  "cancelled_by_shop",
  "no_show",
] as const;
type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Un elemento del jsonb restituito da admin_booking_stats. */
export type StatsGroup = {
  day: string;
  barber_id: string;
  service_id: string;
  status: BookingStatus;
  started: boolean;
  bookings: number;
  revenue_cents: number;
};

export type Granularity = "giorno" | "settimana" | "mese";

/** Periodo vuoto (SPEC §6.9): nessun appuntamento e nessuna cancellazione. */
export const isEmptyBucket = (metrics: Pick<StatsMetrics, "bookings" | "cancellations">): boolean =>
  metrics.bookings === 0 && metrics.cancellations === 0;

export type StatsMetrics = {
  /** confirmed + completed + no_show */
  bookings: number;
  /** price_cents di completed + confirmed */
  revenueCents: number;
  noShows: number;
  /** noShows / prenotazioni non cancellate già iniziate (0..1); null se nessuna */
  noShowRate: number | null;
  cancellations: number;
  cancelledByCustomer: number;
  cancelledByShop: number;
  /** confirmed già iniziate ("Da aggiornare") */
  toClose: number;
};

export type StatsBucket = StatsMetrics & { start: string; end: string };
export type StatsRow = StatsMetrics & { id: string };

export type StatsOptions = {
  from: string;
  to: string;
  granularity: Granularity;
  barberId?: string | null;
  /** Barbieri e servizi attivi: compaiono anche senza prenotazioni nel periodo, a zero. */
  activeBarberIds?: readonly string[];
  activeServiceIds?: readonly string[];
};

export type Stats = {
  totals: StatsMetrics;
  series: StatsBucket[];
  byBarber: StatsRow[];
  byService: StatsRow[];
};

type Accumulator = Omit<StatsMetrics, "noShowRate"> & { started: number };

const emptyAccumulator = (): Accumulator => ({
  bookings: 0,
  revenueCents: 0,
  noShows: 0,
  cancellations: 0,
  cancelledByCustomer: 0,
  cancelledByShop: 0,
  toClose: 0,
  started: 0,
});

function add(acc: Accumulator, group: StatsGroup): void {
  const { status, bookings } = group;
  if (status === "cancelled_by_customer" || status === "cancelled_by_shop") {
    acc.cancellations += bookings;
    if (status === "cancelled_by_customer") acc.cancelledByCustomer += bookings;
    else acc.cancelledByShop += bookings;
    return;
  }
  acc.bookings += bookings;
  if (group.started) acc.started += bookings;
  if (status === "no_show") acc.noShows += bookings;
  else acc.revenueCents += group.revenue_cents;
  if (status === "confirmed" && group.started) acc.toClose += bookings;
}

function toMetrics({ started, ...rest }: Accumulator): StatsMetrics {
  return { ...rest, noShowRate: started === 0 ? null : rest.noShows / started };
}

/** Bucket del periodo in ordine cronologico, con primo e ultimo tagliati ai bordi. */
function bucketRanges(from: string, to: string, granularity: Granularity): { start: string; end: string }[] {
  const ranges: { start: string; end: string }[] = [];
  let start = from;
  while (start <= to) {
    const naturalEnd =
      granularity === "giorno" ? start : granularity === "settimana" ? addDays(startOfWeek(start), 6) : endOfMonth(start);
    const end = minDay(naturalEnd, to);
    ranges.push({ start: maxDay(start, from), end });
    start = addDays(end, 1);
  }
  return ranges;
}

function rows(
  groups: readonly StatsGroup[],
  key: (group: StatsGroup) => string,
  activeIds: readonly string[],
): StatsRow[] {
  const accumulators = new Map<string, Accumulator>();
  for (const id of activeIds) if (!accumulators.has(id)) accumulators.set(id, emptyAccumulator());
  for (const group of groups) {
    const id = key(group);
    let acc = accumulators.get(id);
    if (!acc) {
      acc = emptyAccumulator();
      accumulators.set(id, acc);
    }
    add(acc, group);
  }
  return [...accumulators]
    .map(([id, acc]) => ({ id, ...toMetrics(acc) }))
    .sort(
      (a, b) =>
        b.bookings - a.bookings || b.revenueCents - a.revenueCents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

export function buildStats(groups: readonly StatsGroup[], options: StatsOptions): Stats {
  const { from, to, granularity, barberId } = options;
  const considered = groups.filter(
    (group) => group.day >= from && group.day <= to && (!barberId || group.barber_id === barberId),
  );

  // Una sola passata sui gruppi: ogni giorno del periodo punta all'accumulatore del suo bucket.
  const buckets = bucketRanges(from, to, granularity).map((range) => ({ ...range, acc: emptyAccumulator() }));
  const bucketByDay = new Map<string, Accumulator>();
  for (const bucket of buckets) {
    for (let day = bucket.start; day <= bucket.end; day = addDays(day, 1)) bucketByDay.set(day, bucket.acc);
  }

  const totals = emptyAccumulator();
  for (const group of considered) {
    add(totals, group);
    const acc = bucketByDay.get(group.day);
    if (acc) add(acc, group);
  }

  const series = buckets.map(({ start, end, acc }) => ({ start, end, ...toMetrics(acc) }));

  const activeBarbers = (options.activeBarberIds ?? []).filter((id) => !barberId || id === barberId);

  return {
    totals: toMetrics(totals),
    series,
    byBarber: rows(considered, (group) => group.barber_id, activeBarbers),
    byService: rows(considered, (group) => group.service_id, options.activeServiceIds ?? []),
  };
}
