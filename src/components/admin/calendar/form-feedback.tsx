import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";
import type { CalendarFormState } from "@/lib/calendar/actions";
import { CALENDAR_ERROR_TEXT, WARNING_TEXT } from "./messages";

/**
 * Esito dei moduli di prenotazione: errore, salvataggio oppure avvisi da confermare. Gli avvisi
 * mostrati viaggiano come `shownWarnings`; "Conferma comunque" li invia con `confirm=1` e il server
 * li ricalcola comunque (decisione fetta 6).
 */
export function CalendarFormFeedback({ state, pending }: { state: CalendarFormState; pending: boolean }) {
  if (state.status === "saved") {
    return (
      <p role="status" className="text-sm font-medium">
        {it.admin.common.saved}
      </p>
    );
  }
  if (state.status === "warnings" && state.warnings) {
    return (
      <div role="alert" className="flex flex-col gap-2 border border-ink bg-surface p-3 text-sm">
        <p className="font-medium">{it.admin.calendar.form.warningsIntro}</p>
        <ul className="list-disc pl-5">
          {state.warnings.map((code) => (
            <li key={code}>{WARNING_TEXT[code]}</li>
          ))}
        </ul>
        {state.warnings.map((code) => (
          <input key={code} type="hidden" name="shownWarnings" value={code} />
        ))}
        <Button type="submit" name="confirm" value="1" disabled={pending} className="self-start">
          {it.admin.calendar.form.confirmAnyway}
        </Button>
      </div>
    );
  }
  const message = CALENDAR_ERROR_TEXT[state.status];
  return message ? (
    <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">
      {message}
    </p>
  ) : null;
}
