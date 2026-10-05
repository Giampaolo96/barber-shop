"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { type CalendarFormState, createManualBooking } from "@/lib/calendar/actions";
import { CALENDAR_LIMITS } from "@/lib/calendar/schemas";
import { CustomerPicker } from "./customer-picker";
import { type Option, SlotFields } from "./fields";
import { CalendarFormFeedback } from "./form-feedback";
import { textareaClass } from "@/components/ui/field";

const t = it.admin.calendar.form;
const initialState: CalendarFormState = { status: "idle" };

/**
 * Nuova prenotazione manuale (SPEC §6.2). Dopo avvisi o errori il modulo riparte dai valori
 * inviati (`state.values`). Cliente registrato e ospite sono sempre nel DOM: il CSS mostra il
 * gruppo del radio scelto, così il modulo funziona anche prima dell'idratazione. Il `key` rimonta
 * il modulo quando cambiano i valori: il reset di React dopo l'azione riporterebbe select e radio
 * alla scelta del primo rendering, non a quella inviata.
 */
export function ManualBookingForm({
  barbers,
  services,
  defaults,
}: {
  barbers: Option[];
  services: Option[];
  defaults: { barberId: string; serviceId: string; date: string; time: string };
}) {
  const [state, formAction, pending] = useActionState(createManualBooking, initialState);
  const values: Record<string, string> = { ...defaults, customerKind: "registered", ...state.values };
  const customer = values.customerId ? { id: values.customerId, label: values.customerLabel ?? "" } : null;

  return (
    <form key={JSON.stringify(values)} action={formAction} noValidate className="group flex max-w-lg flex-col gap-4">
      <SlotFields
        idPrefix="new"
        barbers={barbers}
        services={services}
        values={{ barberId: values.barberId, serviceId: values.serviceId, date: values.date, time: values.time }}
      />
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium">{t.customerLegend}</legend>
        {(["registered", "guest"] as const).map((kind) => (
          <label key={kind} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="customerKind"
              value={kind}
              defaultChecked={values.customerKind === kind}
              className="size-5"
            />
            {kind === "registered" ? t.registeredOption : t.guestOption}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-4 group-has-[[name=customerKind][value=guest]:checked]:hidden">
        <CustomerPicker key={customer?.id ?? "none"} initial={customer} />
      </div>
      <div className="hidden flex-col gap-4 group-has-[[name=customerKind][value=guest]:checked]:flex">
        <div className="flex flex-col gap-2">
          <Label htmlFor="guestName">{t.guestNameLabel}</Label>
          <Input
            id="guestName"
            name="guestName"
            maxLength={CALENDAR_LIMITS.guestName}
            autoComplete="off"
            defaultValue={values.guestName ?? ""}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="guestPhone">{t.guestPhoneLabel}</Label>
          <Input
            id="guestPhone"
            name="guestPhone"
            type="tel"
            autoComplete="off"
            defaultValue={values.guestPhone ?? ""}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="staffNote">{t.staffNoteLabel}</Label>
        <textarea
          id="staffNote"
          name="staffNote"
          maxLength={CALENDAR_LIMITS.staffNote}
          rows={3}
          defaultValue={values.staffNote ?? ""}
          className={textareaClass}
        />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {it.admin.common.save}
      </Button>
      <CalendarFormFeedback state={state} pending={pending} />
    </form>
  );
}
