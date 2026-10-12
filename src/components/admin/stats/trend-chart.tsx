import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { formatCents } from "@/lib/domain/money";
import type { Granularity, StatsBucket } from "@/lib/stats/aggregate";
import { bucketPosition, formatAxisValue, niceScale, timeAxisTicks } from "@/lib/stats/axes";
import { bucketLabel } from "@/lib/stats/format";
import type { StatsChart } from "@/lib/stats/schemas";

const t = it.admin.stats;

// Posizione orizzontale nell'area delle barre, che hanno uno spazio di 0.125rem fra l'una e l'altra:
// `p` 0 è il bordo sinistro, i bordi fra due bucket cadono a metà dello spazio.
const BAR_GAP = "0.125rem";
const xAt = (p: number): string => `calc(${p} * (100% + ${BAR_GAP}) - ${BAR_GAP} / 2)`;

// Oltre queste etichette sull'asse X, sotto i 640 px se ne mostra una sì e una no. I nomi dei
// giorni (al massimo 10, di tre lettere) ci stanno sempre. Le date dei lunedì fino a 5: con 6
// (periodi da 36 giorni in su) a 390 px restano circa 45 px fra l'una e l'altra, non bastano.
const MOBILE_X_LABELS = { day: 10, week: 5, month: 6, year: 6 } as const;

/**
 * Grafico a barre dell'andamento (SPEC §6.9), solo HTML e CSS con i token del tema: una serie,
 * barre piene in inchiostro su una linea di base, con gli assi di riferimento (tacche tonde a
 * sinistra, giorni, lunedì, mesi o anni sotto) in `line`, più leggero dei dati. Il dettaglio di
 * ogni barra compare al passaggio del mouse; la versione accessibile è la tabella dell'andamento
 * sotto, quindi il disegno è nascosto agli screen reader e resta un riepilogo testuale.
 */
export function TrendChart({
  series,
  granularity,
  chart,
}: {
  series: readonly StatsBucket[];
  granularity: Granularity;
  chart: StatsChart;
}) {
  const value = (bucket: StatsBucket) => (chart === "incasso" ? bucket.revenueCents : bucket.bookings);
  const display = (amount: number) => (chart === "incasso" ? formatCents(amount) : String(amount));
  const kind = chart === "incasso" ? "cents" : "count";
  const max = Math.max(0, ...series.map(value));
  const peak = series.find((bucket) => value(bucket) === max);
  const first = series[0];
  const last = series[series.length - 1];

  const { ticks: yTicks, top } = niceScale(max, kind);
  const yLabels = yTicks.map((tick) => formatAxisValue(tick, kind));
  // Larghezza dell'etichetta più lunga più lo spazio fino alle linee (right-2)
  const yWidth = `calc(${Math.max(...yLabels.map((text) => text.length))}ch + 0.75rem)`;

  const xAxis = first && last ? timeAxisTicks(first.start, last.end) : { unit: "day" as const, ticks: [] };
  const xTicks = xAxis.ticks.flatMap((tick) => {
    const p = bucketPosition(tick.day, series, tick.line ? 0 : 0.5);
    return p === null ? [] : [{ ...tick, p }];
  });
  const alternate = xTicks.length > MOBILE_X_LABELS[xAxis.unit];

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">
        {fillText(t.chartTitle, { metric: chart === "incasso" ? t.chart.revenue : t.chart.bookings })}
      </figcaption>
      {max === 0 || !peak ? (
        <p className="text-sm text-muted-foreground">{t.chartEmpty}</p>
      ) : (
        <>
          <p className="sr-only">
            {fillText(t.chartSummary, {
              max: display(max),
              bucket: bucketLabel(peak, granularity),
              table: t.trendTitle,
            })}
          </p>
          <div aria-hidden="true" className="flex pt-2 text-xs tabular-nums text-muted-foreground" data-testid="trend-chart">
            {/* Asse Y: le etichette stanno nel margine sinistro, centrate sulla loro linea */}
            <div className="relative h-48 shrink-0" style={{ width: yWidth }}>
              {yTicks.map((tick, index) => (
                <span
                  key={tick}
                  data-axis-y={tick}
                  className="absolute right-2 translate-y-1/2 leading-none whitespace-nowrap"
                  style={{ bottom: `${(tick / top) * 100}%` }}
                >
                  {yLabels[index]}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative h-48 border-b border-ink">
                {yTicks
                  .filter((tick) => tick > 0)
                  .map((tick) => (
                    <div
                      key={tick}
                      className="absolute inset-x-0 border-t border-line"
                      style={{ bottom: `${(tick / top) * 100}%` }}
                    />
                  ))}
                {xTicks
                  .filter((tick) => tick.line && tick.p > 0)
                  .map((tick) => (
                    <div
                      key={tick.day}
                      className="absolute inset-y-0 w-px -translate-x-1/2 bg-line"
                      style={{ left: xAt(tick.p) }}
                    />
                  ))}
                <div className="relative flex h-full items-end gap-0.5">
                  {series.map((bucket) => {
                    const amount = value(bucket);
                    return (
                      <div key={bucket.start} className="group relative flex h-full min-w-0 flex-1 items-end">
                        {amount > 0 && (
                          <div
                            className="w-full bg-ink group-hover:bg-muted-foreground"
                            style={{ height: `${Math.max((amount / top) * 100, 1)}%` }}
                          />
                        )}
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 border border-ink bg-surface px-2 py-1 whitespace-nowrap text-ink group-hover:block">
                          {bucketLabel(bucket, granularity)}: {display(amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/*
                Asse X: l'etichetta di una linea si sposta a sinistra della propria larghezza per la
                sua posizione (0 a sinistra, metà al centro, tutta a destra), così ai bordi resta
                dentro; i nomi dei giorni stanno al centro del loro giorno, largo abbastanza.
              */}
              <div className={`relative h-6 ${xAxis.unit === "month" ? "max-sm:h-10" : ""}`}>
                {xTicks.map((tick, index) => {
                  const [main, ...rest] = xAxis.unit === "month" ? tick.label.split(" ") : [tick.label];
                  return (
                    <span
                      key={tick.day}
                      data-axis-x={tick.day}
                      className={`absolute top-1.5 text-center leading-tight whitespace-nowrap ${
                        alternate && index % 2 === 1 ? "max-sm:hidden" : ""
                      }`}
                      style={{ left: tick.p === 0 ? 0 : xAt(tick.p), transform: `translateX(${tick.line ? -tick.p * 100 : -50}%)` }}
                    >
                      {main}
                      {/* Su mobile l'anno va a capo sotto il mese, per lasciare spazio alle altre etichette */}
                      {rest.length > 0 && <span className="max-sm:block">{` ${rest.join(" ")}`}</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </figure>
  );
}
