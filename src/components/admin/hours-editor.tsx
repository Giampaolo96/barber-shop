"use client";

import { useActionState, useState } from "react";
import { FormStatus } from "@/components/admin/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { it } from "@/i18n/it";
import { saveWorkingHours } from "@/lib/admin/barber-actions";
import type { HoursState } from "@/lib/admin/barber-actions";

export type HoursSlot = { key: number; weekday: number; start: string; end: string };

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const initialState: HoursState = { status: "idle" };

/** Editor della settimana: più fasce per giorno, un solo salvataggio per tutta la settimana. */
export function HoursEditor({ barberId, initialSlots }: { barberId: string; initialSlots: HoursSlot[] }) {
  const [state, formAction, pending] = useActionState(saveWorkingHours, initialState);
  const [slots, setSlots] = useState(initialSlots);
  const [nextKey, setNextKey] = useState(initialSlots.length);
  const t = it.admin.hours;

  const update = (key: number, field: "start" | "end", value: string) =>
    setSlots((current) => current.map((slot) => (slot.key === key ? { ...slot, [field]: value } : slot)));
  const add = (weekday: number) => {
    setSlots((current) => [...current, { key: nextKey, weekday, start: "", end: "" }]);
    setNextKey((key) => key + 1);
  };
  const remove = (key: number) => setSlots((current) => current.filter((slot) => slot.key !== key));

  const payload = JSON.stringify(
    slots.map(({ weekday, start, end }) => ({ weekday, start, end })),
  );

  return (
    <form action={formAction} noValidate className="flex max-w-2xl flex-col gap-4">
      <input type="hidden" name="barberId" value={barberId} />
      <input type="hidden" name="hours" value={payload} />
      {WEEKDAYS.map((weekday) => {
        const daySlots = slots.filter((slot) => slot.weekday === weekday);
        return (
          <fieldset key={weekday} className="flex flex-col gap-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t.weekdays[weekday]}</legend>
            {daySlots.length === 0 && <p className="text-sm text-muted-foreground">{t.closed}</p>}
            {daySlots.map((slot) => (
              <div key={slot.key} className="flex flex-wrap items-center gap-2">
                <label htmlFor={`start-${slot.key}`} className="text-sm">
                  {t.startLabel}
                </label>
                <Input
                  id={`start-${slot.key}`}
                  type="time"
                  value={slot.start}
                  onChange={(event) => update(slot.key, "start", event.target.value)}
                  className="w-32"
                />
                <label htmlFor={`end-${slot.key}`} className="text-sm">
                  {t.endLabel}
                </label>
                <Input
                  id={`end-${slot.key}`}
                  type="time"
                  value={slot.end}
                  onChange={(event) => update(slot.key, "end", event.target.value)}
                  className="w-32"
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(slot.key)}>
                  {t.removeSlot}
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => add(weekday)}>
              {t.addSlot}
            </Button>
          </fieldset>
        );
      })}
      <Button type="submit" disabled={pending} className="self-start">
        {it.admin.common.save}
      </Button>
      {state.status === "overlap" ? (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">
          {t.overlap}
        </p>
      ) : (
        <FormStatus status={state.status} />
      )}
    </form>
  );
}
