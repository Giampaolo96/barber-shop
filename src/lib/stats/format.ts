import { format } from "date-fns";
import { it as itLocale } from "date-fns/locale";
import { it } from "@/i18n/it";
import { formatItDate, fillText } from "@/lib/admin/text";
import type { Granularity, StatsBucket } from "./aggregate";
import { endOfMonth, startOfMonth } from "./dates";

/** Tasso da 0 a 1 come percentuale intera ("33%"); "—" se non calcolabile (SPEC §6.9). */
export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/**
 * Etichetta di un bucket dell'andamento: il giorno ("05/10/2026"), il mese intero ("ottobre 2026")
 * oppure l'intervallo, per le settimane e per i mesi tagliati dai bordi del periodo.
 */
export function bucketLabel(bucket: Pick<StatsBucket, "start" | "end">, granularity: Granularity): string {
  const { start, end } = bucket;
  if (start === end) return formatItDate(start);
  if (granularity === "mese" && start === startOfMonth(start) && end === endOfMonth(start)) {
    const [year, month] = start.split("-").map(Number);
    // Mezzogiorno UTC: lo stesso giorno in qualunque timezone del processo.
    return format(new Date(Date.UTC(year, month - 1, 15, 12)), "LLLL yyyy", { locale: itLocale });
  }
  return fillText(it.admin.stats.weekOf, { from: formatItDate(start), to: formatItDate(end) });
}
