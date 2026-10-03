import Link from "next/link";
import type { PeriodFormValues } from "@/components/admin/period-form";
import { RowAction } from "@/components/admin/row-action";
import { buttonVariants } from "@/components/ui/button";
import { it } from "@/i18n/it";
import type { PeriodRowState } from "@/lib/admin/period-actions";
import { describePeriod } from "@/lib/admin/periods";
import { fillText, formatItDate } from "@/lib/admin/text";

export type PeriodRow = { id: string; starts_at: string; ends_at: string; reason: string | null };

/** Periodo in ora locale del negozio, come lo mostra l'elenco ("dal ... al ..." o con le ore). */
function periodLabel(row: PeriodRow, tz: string): string {
  const view = describePeriod(new Date(row.starts_at), new Date(row.ends_at), tz);
  const t = it.admin.period;
  if (view.mode === "allDay") {
    return fillText(t.allDayRange, { from: formatItDate(view.fromDate), to: formatItDate(view.toDate) });
  }
  return fillText(t.timedRange, {
    fromDate: formatItDate(view.fromDate),
    fromTime: view.fromTime,
    toDate: formatItDate(view.toDate),
    toTime: view.toTime,
  });
}

/** Valori del modulo di modifica di un periodo salvato. */
export function periodFormValues(row: PeriodRow, tz: string): PeriodFormValues {
  const view = describePeriod(new Date(row.starts_at), new Date(row.ends_at), tz);
  return view.mode === "allDay"
    ? { id: row.id, mode: "allDay", fromDate: view.fromDate, toDate: view.toDate, start: "", end: "", reason: row.reason ?? "" }
    : {
        id: row.id,
        mode: "timed",
        fromDate: "",
        toDate: "",
        start: `${view.fromDate}T${view.fromTime}`,
        end: `${view.toDate}T${view.toTime}`,
        reason: row.reason ?? "",
      };
}

export function PeriodTable({
  rows,
  tz,
  editHref,
  deleteAction,
  barberNames,
}: {
  rows: (PeriodRow & { barber_id?: string })[];
  tz: string;
  editHref: (id: string) => string;
  deleteAction: (previous: PeriodRowState, formData: FormData) => Promise<PeriodRowState>;
  /** Se presente, l'elenco mostra la colonna del barbiere (vista dell'admin). */
  barberNames?: Record<string, string>;
}) {
  if (rows.length === 0) return <p className="text-sm opacity-70">{it.admin.common.empty}</p>;

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b">
          {barberNames && <th className="py-2">{it.admin.timeOff.barberLabel}</th>}
          <th className="py-2">{it.admin.period.periodColumn}</th>
          <th className="py-2">{it.admin.period.reasonLabel}</th>
          <th className="py-2">{it.admin.common.actions}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b align-top">
            {barberNames && <td className="py-2">{barberNames[row.barber_id ?? ""] ?? ""}</td>}
            <td className="py-2">{periodLabel(row, tz)}</td>
            <td className="py-2">{row.reason}</td>
            <td className="flex flex-wrap gap-2 py-2">
              <Link href={editHref(row.id)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {it.admin.common.edit}
              </Link>
              <RowAction
                action={deleteAction}
                fields={{ id: row.id }}
                label={it.admin.common.delete}
                confirmText={it.admin.common.confirmDelete}
                variant="destructive"
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
