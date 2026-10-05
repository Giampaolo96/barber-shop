"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/admin/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
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
  const t = it.admin.settings;

  const text = (name: keyof SettingsValues, label: string, props: React.ComponentProps<"input"> = {}) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={String(values[name])} {...props} />
    </div>
  );
  const number = (name: keyof typeof limits, label: string, min: number) =>
    text(name, label, { type: "number", min, max: limits[name], step: 1, required: true, className: "w-32" });

  return (
    <form action={formAction} noValidate className="flex max-w-lg flex-col gap-4">
      {text("name", t.nameLabel, { required: true, maxLength: 100 })}
      {text("address", t.addressLabel, { maxLength: 200 })}
      {text("phone", t.phoneLabel, { type: "tel", maxLength: 50 })}
      {text("logoUrl", t.logoUrlLabel, { type: "url", maxLength: 2048 })}
      {text("timezone", t.timezoneLabel, { required: true })}
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
      {number("minAdvanceMin", t.minAdvanceLabel, 0)}
      {number("maxHorizonDays", t.maxHorizonLabel, 1)}
      {number("cancelLimitMin", t.cancelLimitLabel, 0)}
      {number("bufferMin", t.bufferLabel, 0)}
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
      <Button type="submit" disabled={pending} className="self-start">
        {it.admin.common.save}
      </Button>
      <FormStatus status={state.status} />
    </form>
  );
}
