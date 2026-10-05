"use client";

import { useActionState } from "react";
import { BookingsWarning, FormStatus } from "@/components/admin/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { saveBarber } from "@/lib/admin/barber-actions";
import type { BarberFormState } from "@/lib/admin/barber-actions";
import { textareaClass } from "@/components/ui/field";

export type BarberFormValues = {
  id: string | null;
  displayName: string;
  photoUrl: string;
  bio: string;
  isActive: boolean;
  serviceIds: string[];
};

export type ServiceOption = { id: string; name: string; isActive: boolean };

const initialState: BarberFormState = { status: "idle" };

export function BarberForm({ values, services }: { values: BarberFormValues; services: ServiceOption[] }) {
  const [state, formAction, pending] = useActionState(saveBarber, initialState);
  const t = it.admin.barbers;

  return (
    <form action={formAction} noValidate className="flex max-w-lg flex-col gap-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">{t.displayNameLabel}</Label>
        <Input id="displayName" name="displayName" required maxLength={100} defaultValue={values.displayName} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="photoUrl">{t.photoUrlLabel}</Label>
        <Input id="photoUrl" name="photoUrl" type="url" maxLength={2048} defaultValue={values.photoUrl} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="bio">{t.bioLabel}</Label>
        <textarea
          id="bio"
          name="bio"
          maxLength={500}
          rows={3}
          defaultValue={values.bio}
          className={textareaClass}
        />
      </div>
      <label htmlFor="isActive" className="flex min-h-11 items-center gap-3 text-sm">
        <input id="isActive" name="isActive" type="checkbox" defaultChecked={values.isActive} className="size-5" />
        {t.activeLabel}
      </label>
      <fieldset className="flex flex-col gap-1 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">{t.servicesLabel}</legend>
        {services.length === 0 && <p className="text-sm text-muted-foreground">{t.noServices}</p>}
        {services.map((service) => (
          <div key={service.id} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              id={`service-${service.id}`}
              name="serviceIds"
              type="checkbox"
              value={service.id}
              defaultChecked={values.serviceIds.includes(service.id)}
              className="size-5"
            />
            <label htmlFor={`service-${service.id}`}>{service.name}</label>
            {!service.isActive && <span className="text-xs text-muted-foreground">{it.admin.common.inactive}</span>}
          </div>
        ))}
      </fieldset>
      <Button type="submit" disabled={pending} className="self-start">
        {it.admin.common.save}
      </Button>
      <FormStatus status={state.status} />
      <BookingsWarning
        status={state.status}
        count={state.futureBookings}
        one={t.deactivatedWithBookingsOne}
        other={t.deactivatedWithBookings}
      />
    </form>
  );
}
