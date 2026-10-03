"use client";

import { useActionState } from "react";
import { BookingsWarning, FormStatus } from "@/components/admin/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { saveService } from "@/lib/admin/service-actions";
import type { ServiceFormState } from "@/lib/admin/service-actions";

export type ServiceFormValues = {
  id: string | null;
  name: string;
  description: string;
  durationMin: string;
  price: string;
  isActive: boolean;
};

const initialState: ServiceFormState = { status: "idle" };

export function ServiceForm({ values }: { values: ServiceFormValues }) {
  const [state, formAction, pending] = useActionState(saveService, initialState);
  const t = it.admin.services;

  return (
    <form action={formAction} noValidate className="flex max-w-lg flex-col gap-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t.nameLabel}</Label>
        <Input id="name" name="name" required maxLength={100} defaultValue={values.name} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="description">{t.descriptionLabel}</Label>
        <textarea
          id="description"
          name="description"
          maxLength={500}
          rows={3}
          defaultValue={values.description}
          className="rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
        />
      </div>
      <div className="flex gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="durationMin">{t.durationLabel}</Label>
          <Input
            id="durationMin"
            name="durationMin"
            type="number"
            min={1}
            max={480}
            step={1}
            required
            defaultValue={values.durationMin}
          />
        </div>
        <div className="flex flex-col gap-2">
          {/* Campo di testo: deve accettare la virgola decimale. */}
          <Label htmlFor="price">{t.priceLabel}</Label>
          <Input
            id="price"
            name="price"
            inputMode="decimal"
            required
            defaultValue={values.price}
          />
        </div>
      </div>
      <label htmlFor="isActive" className="flex min-h-11 items-center gap-3 text-sm">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={values.isActive}
          className="size-5"
        />
        {t.activeLabel}
      </label>
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
