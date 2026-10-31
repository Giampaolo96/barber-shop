"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { cn } from "@/lib/utils";
import { WARNING_TEXT } from "./messages";
import type { MoveDialog, MoveNotice } from "./use-booking-move";

const t = it.admin.calendar;

/**
 * Esito dello spostamento: regione aria-live sempre presente (così gli screen reader annunciano i
 * cambi), "Annulla spostamento" accanto finché è disponibile, dialogo con gli avvisi da confermare.
 */
export function MoveFeedback({
  notice,
  dialog,
  busy,
  dismiss,
}: {
  notice: MoveNotice | null;
  dialog: MoveDialog | null;
  busy: boolean;
  dismiss: () => void;
}) {
  return (
    <>
      {/*
        Su telefono spazio riservato; su desktop nessuno spazio: l'avviso è un riquadro fisso, così la
        griglia non si sposta, e lascia passare i clic. Il live region resta nel DOM.
      */}
      <div className="min-h-11 md:-mb-4 md:h-0 md:min-h-0">
        <div
          data-move-notice={notice ? "true" : undefined}
          className={cn(
            "flex flex-wrap items-center gap-3",
            notice &&
              "md:pointer-events-none md:fixed md:right-6 md:bottom-6 md:z-40 md:max-w-md md:border md:border-control-rest md:bg-surface md:px-4 md:py-2",
          )}
        >
          <p role="status" aria-live="polite" className="text-sm font-medium">
            {notice?.text}
          </p>
          {notice?.undo && (
            <Button type="button" variant="outline" disabled={busy} onClick={notice.undo} className="pointer-events-auto">
              {t.move.undo}
            </Button>
          )}
          {notice?.tone === "error" && (
            <Button type="button" variant="outline" onClick={dismiss} className="pointer-events-auto">
              {t.move.close}
            </Button>
          )}
        </div>
      </div>
      <AlertDialog open={dialog !== null} onOpenChange={(open) => !open && dialog?.cancel()}>
        <AlertDialogContent area="admin">
          <AlertDialogTitle className="text-lg font-semibold">{t.move.dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p>{t.form.warningsIntro}</p>
              <ul className="list-disc pl-5">
                {dialog?.warnings.map((code) => (
                  <li key={code}>{WARNING_TEXT[code]}</li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                {t.move.cancel}
              </Button>
            </AlertDialogCancel>
            {/* Non chiude il dialogo da sé: la chiusura dall'esterno vale come "Annulla". */}
            <Button type="button" onClick={() => dialog?.confirm()}>
              {t.form.confirmAnyway}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
