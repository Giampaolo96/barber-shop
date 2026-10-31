"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { type CalendarFormState, updateBooking } from "@/lib/calendar/actions";
import { CALENDAR_LIMITS } from "@/lib/calendar/schemas";
import { type Option, SlotFields } from "./fields";
import { CalendarFormFeedback } from "./form-feedback";

const t = it.admin.calendar.edit;
const initialState: CalendarFormState = { status: "idle" };

export type EditBookingValues = {
  id: string;
  barberId: string;
  serviceId: string;
  date: string;
  time: string;
  durationMin: string;
  price: string;
};

/**
 * Spostamento e modifica di una prenotazione (SPEC §6.3), solo per l'admin. Il `key` rimonta il
 * modulo quando cambiano i valori (inviati dopo avvisi o errori, salvati dopo un salvataggio): il
 * reset di React riporterebbe i select alla scelta del primo rendering.
 */
export function EditBookingForm({
  barbers,
  services,
  defaults,
}: {
  barbers: Option[];
  services: Option[];
  defaults: EditBookingValues;
}) {
  const [state, formAction, pending] = useActionState(updateBooking, initialState);
  const values: Record<string, string> = { ...defaults, ...state.values };

  return (
    <form
      key={JSON.stringify(values)}
      action={formAction}
      noValidate
      aria-labelledby="edit-booking-title"
      className="flex max-w-lg flex-col gap-4"
    >
      <h2 id="edit-booking-title" className="text-lg font-semibold">
        {t.title}
      </h2>
      <input type="hidden" name="id" value={defaults.id} />
      <SlotFields
        idPrefix="edit"
        barbers={barbers}
        services={services}
        values={{ barberId: values.barberId, serviceId: values.serviceId, date: values.date, time: values.time }}
      />
      <p className="text-xs text-muted-foreground">{t.serviceChangeHint}</p>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-durationMin">{t.durationLabel}</Label>
          <Input
            id="edit-durationMin"
            name="durationMin"
            type="number"
            min={CALENDAR_LIMITS.minDuration}
            max={CALENDAR_LIMITS.maxDuration}
            step={1}
            required
            defaultValue={values.durationMin}
            className="h-11"
          />
        </div>
        <div className="flex flex-col gap-2">
          {/* Campo di testo: deve accettare la virgola decimale. */}
          <Label htmlFor="edit-price">{t.priceLabel}</Label>
          <Input id="edit-price" name="price" inputMode="decimal" required defaultValue={values.price} className="h-11" />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {it.admin.calendar.edit.saveChanges}
      </Button>
      <CalendarFormFeedback state={state} pending={pending} />
    </form>
  );
}
