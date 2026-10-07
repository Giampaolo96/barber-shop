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
}: {
  notice: MoveNotice | null;
  dialog: MoveDialog | null;
  busy: boolean;
}) {
  return (
    <>
      <div className="flex min-h-11 flex-wrap items-center gap-3">
        <p role="status" aria-live="polite" className="text-sm font-medium">
          {notice?.text}
        </p>
        {notice?.undo && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={notice.undo}>
            {t.move.undo}
          </Button>
        )}
      </div>
      <AlertDialog open={dialog !== null} onOpenChange={(open) => !open && dialog?.cancel()}>
        <AlertDialogContent>
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
