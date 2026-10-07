"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { type CalendarFormState, moveBookingFromForm } from "@/lib/calendar/actions";
import { TIME_STEP_MIN } from "@/lib/calendar/schemas";
import { CalendarFormFeedback } from "./form-feedback";

const t = it.admin.calendar;
const initialState: CalendarFormState = { status: "idle" };

/**
 * "Sposta orario" (fetta 6c): alternativa accessibile al trascinamento per il barbiere, sulle
 * proprie confirmed non ancora iniziate, nella propria colonna. Il `key` rimonta il modulo con i
 * valori inviati dopo avvisi o errori (come la modifica dell'admin).
 */
export function MoveBookingForm({
  id,
  barberId,
  startsAt,
  date,
  time,
}: {
  id: string;
  barberId: string;
  /** Inizio salvato (ISO): se nel frattempo cambia, lo spostamento viene rifiutato. */
  startsAt: string;
  date: string;
  time: string;
}) {
  const [state, formAction, pending] = useActionState(moveBookingFromForm, initialState);
  const values = { date, time, ...state.values };

  return (
    <form
      key={JSON.stringify(values)}
      action={formAction}
      noValidate
      aria-labelledby="move-booking-title"
      className="flex max-w-lg flex-col gap-4"
    >
      <h2 id="move-booking-title" className="text-lg font-semibold">
        {t.move.formTitle}
      </h2>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expectedBarberId" value={barberId} />
      <input type="hidden" name="expectedStartsAt" value={startsAt} />
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="move-date">{t.form.dateLabel}</Label>
          <Input id="move-date" name="date" type="date" required defaultValue={values.date} className="h-11" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="move-time">{t.form.timeLabel}</Label>
          <Input
            id="move-time"
            name="time"
            type="time"
            step={TIME_STEP_MIN * 60}
            required
            defaultValue={values.time}
            className="h-11"
          />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t.move.submit}
      </Button>
      <CalendarFormFeedback state={state} pending={pending} />
    </form>
  );
}
