import Link from "next/link";
import { type StatsTableRow, StatsTable } from "@/components/admin/stats/stats-tables";
import { TrendChart } from "@/components/admin/stats/trend-chart";
import { Button, buttonVariants } from "@/components/ui/button";
import { selectClass } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { getShopTimezone } from "@/lib/admin/queries";
import { fillText, formatItDate } from "@/lib/admin/text";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";
import { getBookingStats, getStatsCatalog, type StatsCatalogItem } from "@/lib/db/stats";
import { localDateOf } from "@/lib/domain/local-time";
import { formatCents } from "@/lib/domain/money";
import { buildStats, type Stats, type StatsRow } from "@/lib/stats/aggregate";
import { bucketLabel, formatRate } from "@/lib/stats/format";
import { STATS_PATH, statsPath, statsToUpdatePath } from "@/lib/stats/paths";
import { periodShortcut, STATS_SHORTCUTS } from "@/lib/stats/periods";
import { type StatsParams, statsSearchParamsSchema } from "@/lib/stats/schemas";

const t = it.admin.stats;

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

type StatsData = { stats: Stats; barbers: StatsCatalogItem[]; services: StatsCatalogItem[] };

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function loadStats(supabase: ServerClient, params: StatsParams): Promise<StatsData | null> {
  try {
    const [groups, { barbers, services }] = await Promise.all([
      getBookingStats(supabase, params),
      getStatsCatalog(supabase),
    ]);
    const stats = buildStats(groups, {
      from: params.from,
      to: params.to,
      granularity: params.granularity,
      barberId: params.barberId,
      activeBarberIds: barbers.filter((barber) => barber.isActive).map((barber) => barber.id),
      activeServiceIds: services.filter((service) => service.isActive).map((service) => service.id),
    });
    return { stats, barbers, services };
  } catch (error) {
    console.error("AdminStatsPage", error);
    return null;
  }
}

function catalogRows(rows: readonly StatsRow[], catalog: readonly StatsCatalogItem[]): StatsTableRow[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  return rows.map((row) => {
    const item = byId.get(row.id);
    return {
      ...row,
      key: row.id,
      label: (
        <>
          <span>{item?.name ?? t.unknown}</span>
          {item && !item.isActive && <span className="text-muted-foreground"> ({t.inactive})</span>}
        </>
      ),
    };
  });
}

// Statistiche base dell'admin (SPEC §6.9, ADR 010): prenotazioni, incasso stimato e no-show del
// periodo, andamento, per barbiere e per servizio.
export default async function AdminStatsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // I layout non si rieseguono a ogni navigazione: ogni pagina ricontrolla il ruolo.
  await requireRole(["admin"]);
  const raw = await searchParams;

  // Un solo client per richiesta. Se le impostazioni non si leggono interviene error.tsx.
  const supabase = await createClient();
  const today = localDateOf(new Date(), await getShopTimezone(supabase));
  const params = statsSearchParamsSchema(today).parse({
    dal: first(raw.dal),
    al: first(raw.al),
    raggruppa: first(raw.raggruppa),
    barbiere: first(raw.barbiere),
    escludi_demo: first(raw.escludi_demo),
    grafico: first(raw.grafico),
  });
  const data = await loadStats(supabase, params);

  return (
    <>
      <h1 className="font-display text-4xl leading-tight">{it.admin.nav.stats}</h1>

      <form action={STATS_PATH} method="get" aria-label={t.filtersLabel} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="statsFrom">{t.fromLabel}</Label>
            <Input id="statsFrom" name="dal" type="date" required defaultValue={params.from} className="w-44" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="statsTo">{t.toLabel}</Label>
            <Input id="statsTo" name="al" type="date" required defaultValue={params.to} className="w-44" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="statsGroupBy">{t.groupByLabel}</Label>
            <select id="statsGroupBy" name="raggruppa" defaultValue={params.granularity} className={selectClass}>
              <option value="giorno">{t.granularity.day}</option>
              <option value="settimana">{t.granularity.week}</option>
              <option value="mese">{t.granularity.month}</option>
            </select>
          </div>
          {data ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="statsBarber">{t.barberLabel}</Label>
              <select id="statsBarber" name="barbiere" defaultValue={params.barberId ?? ""} className={selectClass}>
                <option value="">{t.allBarbers}</option>
                {data.barbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.isActive ? barber.name : `${barber.name} (${t.inactive})`}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            // Senza l'elenco dei barbieri il filtro scelto resta e "Applica" lo conserva.
            params.barberId && <input type="hidden" name="barbiere" value={params.barberId} />
          )}
          <label className="flex h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="escludi_demo"
              value="1"
              defaultChecked={params.excludeDemo}
              className="size-5"
            />
            {t.excludeDemo}
          </label>
          {params.chart !== "prenotazioni" && <input type="hidden" name="grafico" value={params.chart} />}
          <Button type="submit">{t.apply}</Button>
        </div>
        <nav aria-label={t.shortcutsLabel} className="flex flex-wrap gap-2">
          {STATS_SHORTCUTS.map((key) => (
            <Link
              key={key}
              href={statsPath({ ...params, ...periodShortcut(key, today) })}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t.shortcuts[key]}
            </Link>
          ))}
        </nav>
      </form>

      <p className="text-sm text-muted-foreground">
        {fillText(t.period, { from: formatItDate(params.from), to: formatItDate(params.to) })}
      </p>

      {data === null ? (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-sm">
          {t.error}
        </p>
      ) : (
        <StatsContent data={data} params={params} />
      )}
    </>
  );
}

function StatsContent({ data, params }: { data: StatsData; params: StatsParams }) {
  const { stats, barbers, services } = data;
  const { totals } = stats;
  const tiles = [
    { stat: "bookings", label: t.totals.bookings, value: String(totals.bookings), hint: t.totalsHint.bookings },
    { stat: "revenue", label: t.totals.revenue, value: formatCents(totals.revenueCents), hint: t.totalsHint.revenue },
    {
      stat: "no-show-rate",
      label: t.totals.noShowRate,
      value: formatRate(totals.noShowRate),
      hint: t.totalsHint.noShowRate,
    },
    {
      stat: "cancellations",
      label: t.totals.cancellations,
      value: String(totals.cancellations),
      hint: fillText(t.totalsHint.cancellations, {
        customer: totals.cancelledByCustomer,
        shop: totals.cancelledByShop,
      }),
    },
    { stat: "to-close", label: t.totals.toClose, value: String(totals.toClose), hint: t.totalsHint.toClose },
  ];
  // "Da aggiornare" porta all'elenco di quegli appuntamenti, dove si apre il dettaglio.
  const toUpdateHref = totals.toClose > 0 ? statsToUpdatePath(params) : null;

  return (
    <>
      <dl className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-5">
        {tiles.map((tile) => (
          <div
            key={tile.stat}
            data-stat={tile.stat}
            className={`relative flex flex-col gap-1 bg-surface p-4 last:col-span-2 lg:last:col-span-1 ${
              tile.stat === "to-close" && toUpdateHref ? "ring-1 ring-ink ring-inset hover:bg-disabled" : ""
            }`}
          >
            <dt className="text-sm text-muted-foreground">{tile.label}</dt>
            <dd data-stat-value className="font-display text-2xl whitespace-nowrap tabular-nums sm:text-3xl">
              {tile.value}
            </dd>
            {tile.stat === "to-close" && toUpdateHref ? (
              <dd className="text-xs">
                {/* Collegamento esteso a tutto il riquadro */}
                <Link
                  href={toUpdateHref}
                  aria-label={fillText(t.toCloseLink, { count: totals.toClose })}
                  className="underline underline-offset-4 after:absolute after:inset-0"
                >
                  {tile.hint}
                </Link>
              </dd>
            ) : (
              tile.hint && <dd className="text-xs text-muted-foreground">{tile.hint}</dd>
            )}
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-3">
        <nav aria-label={t.chartLabel} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t.chartLabel}</span>
          {(["prenotazioni", "incasso"] as const).map((chart) => (
            <Link
              key={chart}
              href={statsPath({ ...params, chart })}
              aria-current={params.chart === chart ? "true" : undefined}
              className={buttonVariants({ variant: params.chart === chart ? "default" : "outline", size: "sm" })}
            >
              {chart === "incasso" ? t.chart.revenue : t.chart.bookings}
            </Link>
          ))}
        </nav>
        <TrendChart series={stats.series} granularity={params.granularity} chart={params.chart} />
      </section>

      <StatsTable
        title={t.trendTitle}
        firstColumn={it.admin.stats.columns.period}
        rows={stats.series.map((bucket) => ({
          ...bucket,
          key: bucket.start,
          label: bucketLabel(bucket, params.granularity),
        }))}
      />
      <StatsTable
        title={t.byBarberTitle}
        firstColumn={it.admin.stats.columns.barber}
        rows={catalogRows(stats.byBarber, barbers)}
      />
      <StatsTable
        title={t.byServiceTitle}
        firstColumn={it.admin.stats.columns.service}
        rows={catalogRows(stats.byService, services)}
      />
    </>
  );
}
