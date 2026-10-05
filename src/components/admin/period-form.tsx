"use client";

import { useActionState } from "react";
import { BookingsWarning, FormStatus } from "@/components/admin/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { saveClosure, saveTimeOff } from "@/lib/admin/period-actions";
import type { PeriodFormState } from "@/lib/admin/period-actions";
import { selectClass } from "@/components/ui/field";

/** Valori iniziali in ora locale del negozio (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`). */
export type PeriodFormValues = {
  id: string | null;
  mode: "allDay" | "timed";
  fromDate: string;
  toDate: string;
  start: string;
  end: string;
  reason: string;
};

export const EMPTY_PERIOD: PeriodFormValues = {
  id: null,
  mode: "allDay",
  fromDate: "",
  toDate: "",
  start: "",
  end: "",
  reason: "",
};

const initialState: PeriodFormState = { status: "idle" };

/**
 * Modulo di assenze e chiusure. `barberId` serve solo all'admin che inserisce l'assenza di un
 * barbiere: il barbiere scrive sempre sulla propria scheda.
 */
export function PeriodForm({
  kind,
  values,
  barberId,
  barbers,
}: {
  kind: "timeOff" | "closure";
  values: PeriodFormValues;
  barberId?: string;
  /** Solo per l'admin: scelta del barbiere, preselezionato su `barberId`. */
  barbers?: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    kind === "closure" ? saveClosure : saveTimeOff,
    initialState,
  );
  const t = it.admin.period;
  // La modalità non è stato React: i due gruppi di campi stanno sempre nel DOM e il CSS mostra
  // quello del radio selezionato. Così il modulo funziona anche prima dell'idratazione (un clic
  // arrivato prima non andrebbe perso). Il server legge solo i campi della modalità inviata.

  return (
    <form action={formAction} noValidate className="group flex max-w-lg flex-col gap-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {barbers ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="barberId">{it.admin.timeOff.barberLabel}</Label>
          <select
            id="barberId"
            name="barberId"
            required
            defaultValue={barberId ?? barbers[0]?.id}
            className={selectClass}
          >
            {barbers.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        barberId && <input type="hidden" name="barberId" value={barberId} />
      )}
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium">{t.modeLabel}</legend>
        {(["allDay", "timed"] as const).map((option) => (
          <label key={option} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value={option}
              defaultChecked={values.mode === option}
              className="size-5"
            />
            {t[option]}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-4 group-has-[[name=mode][value=timed]:checked]:hidden">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fromDate">{t.fromDateLabel}</Label>
          <Input
            id="fromDate"
            name="fromDate"
            type="date"
            required
            defaultValue={values.fromDate}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="toDate">{t.toDateLabel}</Label>
          <Input id="toDate" name="toDate" type="date" required defaultValue={values.toDate} />
        </div>
      </div>
      <div className="hidden flex-wrap gap-4 group-has-[[name=mode][value=timed]:checked]:flex">
        <div className="flex flex-col gap-2">
          <Label htmlFor="start">{t.startLabel}</Label>
          <Input
            id="start"
            name="start"
            type="datetime-local"
            required
            defaultValue={values.start}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="end">{t.endLabel}</Label>
          <Input id="end" name="end" type="datetime-local" required defaultValue={values.end} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reason">{t.reasonLabel}</Label>
        <Input id="reason" name="reason" maxLength={200} defaultValue={values.reason} />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {it.admin.common.save}
      </Button>
      <FormStatus status={state.status} />
      <BookingsWarning
        status={state.status}
        count={state.overlapping}
        one={t.overlapsBookingsOne}
        other={t.overlapsBookings}
      />
    </form>
  );
}
