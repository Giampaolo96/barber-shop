import type { ReactNode } from "react";
import { it } from "@/i18n/it";
import { formatCents } from "@/lib/domain/money";
import type { StatsMetrics } from "@/lib/stats/aggregate";
import { formatRate } from "@/lib/stats/format";

const c = it.admin.stats.columns;

export type StatsTableRow = StatsMetrics & { key: string; label: ReactNode };

/**
 * Tabella delle metriche (andamento, per barbiere, per servizio): una riga per voce, le stesse
 * colonne dei riquadri dei totali. Il nome accessibile è la didascalia.
 */
export function StatsTable({
  title,
  firstColumn,
  rows,
}: {
  title: string;
  firstColumn: string;
  rows: readonly StatsTableRow[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm tabular-nums">
        <caption className="pb-2 text-left font-display text-2xl">{title}</caption>
        <thead>
          <tr className="border-b border-ink">
            <th scope="col" className="py-2 pr-4 font-medium">{firstColumn}</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">{c.bookings}</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">{c.revenue}</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">{c.noShows}</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">{c.noShowRate}</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">{c.cancellations}</th>
            <th scope="col" className="py-2 text-right font-medium">{c.toClose}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line align-top">
              <th scope="row" className="py-2 pr-4 font-normal whitespace-nowrap">{row.label}</th>
              <td className="py-2 pr-4 text-right">{row.bookings}</td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">{formatCents(row.revenueCents)}</td>
              <td className="py-2 pr-4 text-right">{row.noShows}</td>
              <td className="py-2 pr-4 text-right">{formatRate(row.noShowRate)}</td>
              <td className="py-2 pr-4 text-right">{row.cancellations}</td>
              <td className="py-2 text-right">{row.toClose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
