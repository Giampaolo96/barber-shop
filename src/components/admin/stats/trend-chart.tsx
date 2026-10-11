import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { formatCents } from "@/lib/domain/money";
import type { Granularity, StatsBucket } from "@/lib/stats/aggregate";
import { bucketLabel } from "@/lib/stats/format";
import type { StatsChart } from "@/lib/stats/schemas";

const t = it.admin.stats;

/**
 * Grafico a barre dell'andamento (SPEC §6.9), solo HTML e CSS con i token del tema: una serie,
 * barre piene in inchiostro su una linea di base. Il dettaglio di ogni barra compare al passaggio
 * del mouse; la versione accessibile è la tabella dell'andamento sotto, quindi il grafico è
 * nascosto agli screen reader.
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
  const max = Math.max(0, ...series.map(value));
  const first = series[0];
  const last = series[series.length - 1];

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">
        {fillText(t.chartTitle, { metric: chart === "incasso" ? t.chart.revenue : t.chart.bookings })}
      </figcaption>
      {max === 0 ? (
        <p className="text-sm text-muted-foreground">{t.chartEmpty}</p>
      ) : (
        <div aria-hidden="true" className="flex flex-col gap-1" data-testid="trend-chart">
          <div className="text-xs tabular-nums text-muted-foreground">{display(max)}</div>
          <div className="flex h-48 items-end gap-0.5 border-b border-ink">
            {series.map((bucket) => {
              const amount = value(bucket);
              return (
                <div key={bucket.start} className="group relative flex h-full min-w-0 flex-1 items-end">
                  {amount > 0 && (
                    <div
                      className="w-full bg-ink group-hover:bg-muted-foreground"
                      style={{ height: `${Math.max((amount / max) * 100, 1)}%` }}
                    />
                  )}
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap border border-ink bg-surface px-2 py-1 text-xs tabular-nums text-ink group-hover:block">
                    {bucketLabel(bucket, granularity)}: {display(amount)}
                  </div>
                </div>
              );
            })}
          </div>
          {first && last && (
            <div className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span>{bucketLabel(first, granularity)}</span>
              {last !== first && <span className="text-right">{bucketLabel(last, granularity)}</span>}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
