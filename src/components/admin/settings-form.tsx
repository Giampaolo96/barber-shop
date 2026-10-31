"use client";

import { type ReactNode, useActionState, useState } from "react";
import { FormStatus } from "@/components/admin/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { minutesEffect, type MinutesKind } from "@/lib/admin/minutes-effect";
import { saveSettings } from "@/lib/admin/settings-actions";
import type { SettingsState } from "@/lib/admin/settings-actions";
import { selectClass } from "@/components/ui/field";

export type SettingsValues = {
  name: string;
  address: string;
  phone: string;
  logoUrl: string;
  timezone: string;
  slotGranularityMin: number;
  minAdvanceMin: number;
  maxHorizonDays: number;
  cancelLimitMin: number;
  bufferMin: number;
  noShowBlockThreshold: number;
  privacyPolicyVersion: string;
};

const initialState: SettingsState = { status: "idle" };

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <h2 className="font-display text-2xl">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsForm({
  values,
  granularityOptions,
  limits,
}: {
  values: SettingsValues;
  granularityOptions: readonly number[];
  limits: Record<"minAdvanceMin" | "maxHorizonDays" | "cancelLimitMin" | "bufferMin" | "noShowBlockThreshold", number>;
}) {
  const [state, formAction, pending] = useActionState(saveSettings, initialState);
  // Solo per l'effetto accanto ai campi in minuti: i campi restano non controllati.
  const [minutes, setMinutes] = useState<Record<MinutesKind, string>>({
    minAdvance: String(values.minAdvanceMin),
    cancelLimit: String(values.cancelLimitMin),
    buffer: String(values.bufferMin),
  });
  const t = it.admin.settings;

  const text = (name: keyof SettingsValues, label: string, props: React.ComponentProps<"input"> = {}) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={String(values[name])} {...props} />
    </div>
  );
  const number = (name: keyof typeof limits, label: string, min: number) =>
    text(name, label, { type: "number", min, max: limits[name], step: 1, required: true, className: "w-32" });
  const minutesField = (name: keyof typeof limits, label: string, min: number, kind: MinutesKind) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <div className="flex items-center gap-3">
        <Input
          id={name}
          name={name}
          defaultValue={String(values[name])}
          type="number"
          min={min}
          max={limits[name]}
          step={1}
          required
          aria-describedby={`${name}Effect`}
          className="w-32"
          onChange={(event) => setMinutes((current) => ({ ...current, [kind]: event.target.value }))}
        />
        <p id={`${name}Effect`} className="text-sm text-muted-foreground">
          {minutes[kind].trim() === "" ? "" : minutesEffect(kind, Number(minutes[kind]))}
        </p>
      </div>
    </div>
  );

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      <div className="grid max-w-5xl gap-x-12 gap-y-8 lg:grid-cols-2 lg:items-start">
        <Group title={t.groups.shop}>
          {text("name", t.nameLabel, { required: true, maxLength: 100 })}
          {text("address", t.addressLabel, { maxLength: 200 })}
          {text("phone", t.phoneLabel, { type: "tel", maxLength: 50 })}
          {text("logoUrl", t.logoUrlLabel, { type: "url", maxLength: 2048 })}
          {text("timezone", t.timezoneLabel, { required: true })}
        </Group>
        <Group title={t.groups.bookings}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="slotGranularityMin">{t.slotGranularityLabel}</Label>
            <select
              id="slotGranularityMin"
              name="slotGranularityMin"
              defaultValue={String(values.slotGranularityMin)}
              className={`${selectClass} w-32`}
            >
              {granularityOptions.map((option) => (
                <option key={option} value={String(option)}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          {minutesField("minAdvanceMin", t.minAdvanceLabel, 0, "minAdvance")}
          {number("maxHorizonDays", t.maxHorizonLabel, 1)}
          {minutesField("cancelLimitMin", t.cancelLimitLabel, 0, "cancelLimit")}
          {minutesField("bufferMin", t.bufferLabel, 0, "buffer")}
        </Group>
        <Group title={t.groups.rules}>
          {number("noShowBlockThreshold", t.noShowThresholdLabel, 0)}
          {/* Sola lettura, senza name: non viene inviata (fetta 9, flusso di nuovo consenso). */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="privacyPolicyVersion">{t.privacyPolicyVersionLabel}</Label>
            <Input
              id="privacyPolicyVersion"
              defaultValue={values.privacyPolicyVersion}
              readOnly
              aria-describedby="privacyPolicyVersionNote"
              className="bg-muted"
            />
            <p id="privacyPolicyVersionNote" className="text-sm text-muted-foreground">
              {t.privacyPolicyVersionNote}
            </p>
          </div>
        </Group>
      </div>
      {/* Sempre raggiungibile: il modulo è più alto dello schermo. */}
      <div className="sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center gap-4 border-t border-line bg-surface px-6 py-3">
        <Button type="submit" disabled={pending}>
          {it.admin.common.save}
        </Button>
        <FormStatus status={state.status} />
      </div>
    </form>
  );
}
