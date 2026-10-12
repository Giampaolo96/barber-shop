import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { formatCents } from "@/lib/domain/money";
import type { Granularity, StatsBucket } from "@/lib/stats/aggregate";
import { alternateLabels, chartAxis, formatAxisValue, niceScale, spacedLabels } from "@/lib/stats/axes";
import { bucketLabel } from "@/lib/stats/format";
import type { StatsChart } from "@/lib/stats/schemas";

const t = it.admin.stats;

// Spazio fra le barre: 0.125rem, ma mai più di un quarto dello spazio di una barra, altrimenti con
// molte barre (un anno per giorno a 390 px) gli spazi da soli superano la larghezza del grafico.
// `unit` è "cqw" dentro l'area delle barre, che è un container: vale per lo spazio fra le barre e per
// la linea di confine, figlia di una barra, dove una percentuale si riferirebbe alla barra stessa.
// "%" per la riga delle etichette, che è larga quanto l'area.
const barGap = (count: number, unit: "%" | "cqw"): string => `min(0.125rem, ${25 / count}${unit})`;

// Posizione orizzontale delle etichette sotto le barre: `p` 0 è il bordo sinistro, i confini fra
// due bucket cadono a metà dello spazio fra le barre.
const xAt = (p: number, gap: string): string => `calc(${p} * (100% + ${gap}) - ${gap} / 2)`;

// Oltre queste etichette sull'asse X, sotto i 640 px se ne mostra una sì e una no. Le date dei
// lunedì fino a 5: con 6 (periodi da 36 giorni in su) a 390 px restano circa 45 px fra l'una e
// l'altra, non bastano.
const MOBILE_X_LABELS = { week: 5, month: 6, year: 6 } as const;

// I nomi dei giorni (tre lettere) sotto i 640 px stanno ad almeno un decimo della larghezza l'uno
// dall'altro, circa 30 px a 390: dieci giorni per giorno ci stanno tutti, su barre per settimana
// tagliate dal periodo si diradano.
const MOBILE_DAY_LABEL_GAP = 0.1;

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

  const { ticks: yTicks, top } = niceScale(max, kind);
  const yLabels = yTicks.map((tick) => formatAxisValue(tick, kind));
  // Larghezza dell'etichetta più lunga più lo spazio fino alle linee (right-2)
  const yWidth = `calc(${Math.max(...yLabels.map((text) => text.length))}ch + 0.75rem)`;

  const gap = barGap(Math.max(series.length, 1), "cqw");
  const labelGap = barGap(Math.max(series.length, 1), "%");
  const xAxis = chartAxis(series, granularity);
  const mobileVisible =
    xAxis.unit === "day"
      ? spacedLabels(
          xAxis.marks.map((mark) => mark.at),
          MOBILE_DAY_LABEL_GAP,
        )
      : xAxis.marks.length > MOBILE_X_LABELS[xAxis.unit]
        ? alternateLabels(xAxis.marks.map((mark) => mark.label))
        : null;
  const lineBefore = new Set(xAxis.marks.flatMap((mark) => (mark.line === null ? [] : [mark.line])));

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
              <div className="relative h-48 border-b border-ink @container">
                {yTicks
                  .filter((tick) => tick > 0)
                  .map((tick) => (
                    <div
                      key={tick}
                      className="absolute inset-x-0 border-t border-line"
                      style={{ bottom: `${(tick / top) * 100}%` }}
                    />
                  ))}
                <div className="relative flex h-full items-end" style={{ columnGap: gap }}>
                  {series.map((bucket, index) => {
                    const amount = value(bucket);
                    return (
                      <div
                        key={bucket.start}
                        data-bar={bucket.start}
                        className="group relative flex h-full min-w-0 flex-1 items-end"
                      >
                        {/*
                          Linea sul confine con la barra precedente: sta nello spazio fra le due
                          barre, larga al massimo quanto lo spazio, quindi non le tocca mai.
                        */}
                        {lineBefore.has(index) && (
                          <div
                            data-axis-line={bucket.start}
                            className="pointer-events-none absolute inset-y-0 right-full flex justify-center"
                            style={{ width: gap }}
                          >
                            <div className="h-full w-px max-w-full bg-line" />
                          </div>
                        )}
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
                Asse X: ogni etichetta sta sotto la sua barra. Quelle dei giorni e dei mesi (una per
                barra) sono centrate; quelle dei lunedì e dei mesi sui confini si spostano a sinistra
                della propria larghezza per la loro posizione (0 a sinistra, metà al centro, tutta a
                destra), così ai bordi restano dentro.
              */}
              <div className={`relative h-6 ${xAxis.unit === "month" ? "max-sm:h-10" : ""}`}>
                {xAxis.marks.map((mark, index) => {
                  const [main, ...rest] = xAxis.unit === "month" ? mark.label.split(" ") : [mark.label];
                  return (
                    <span
                      key={mark.day}
                      data-axis-x={mark.day}
                      className={`absolute top-1.5 text-center leading-tight whitespace-nowrap ${
                        mobileVisible && !mobileVisible[index] ? "max-sm:hidden" : ""
                      }`}
                      style={{
                        left: xAt(mark.at, labelGap),
                        transform: `translateX(${xAxis.perBar ? -50 : -mark.at * 100}%)`,
                      }}
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
