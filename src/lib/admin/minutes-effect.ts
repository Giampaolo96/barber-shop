import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";

export type MinutesKind = "minAdvance" | "cancelLimit" | "buffer";

const t = it.admin.settings.minutesEffect;
const HOUR = 60;
const DAY = 24 * HOUR;

const unit = (labels: { one: string; other: string }, count: number): string =>
  fillText(count === 1 ? labels.one : labels.other, { count });

/** Le due unità più grandi diverse da zero: "1 giorno e 1 ora", "2 ore", "45 minuti". */
function duration(minutes: number): string {
  const parts = [
    [Math.floor(minutes / DAY), t.day],
    [Math.floor((minutes % DAY) / HOUR), t.hour],
    [minutes % HOUR, t.minute],
  ] as const;
  const [first, second] = parts.filter(([count]) => count > 0).map(([count, labels]) => unit(labels, count));
  return second ? fillText(t.and, { first, second }) : first;
}

/** Effetto leggibile di un valore in minuti delle impostazioni; "" se il valore non è valido. */
export function minutesEffect(kind: MinutesKind, minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "";
  if (minutes === 0) return { minAdvance: t.anytime, cancelLimit: t.untilStart, buffer: t.noPause }[kind];
  return fillText(kind === "buffer" ? t.pause : t.before, { time: duration(minutes) });
}
