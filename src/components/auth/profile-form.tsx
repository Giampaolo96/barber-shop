"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { type ProfileFormState, updateProfile } from "@/lib/auth/account-actions";

const initialState: ProfileFormState = { status: "idle" };

/** Nome, telefono e consenso marketing del cliente (fetta 9b); `marketingNote` è la data dell'ultimo cambio. */
export function ProfileForm({
  fullName,
  phone,
  marketingConsent,
  marketingNote,
}: {
  fullName: string;
  phone: string;
  marketingConsent: boolean;
  marketingNote: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateProfile, initialState);
  const t = it.profile;

  return (
    <form action={formAction} noValidate className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">{t.fullNameLabel}</Label>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          maxLength={100}
          required
          defaultValue={fullName}
          className="h-11"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">{t.phoneLabel}</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          defaultValue={phone}
          className="h-11"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="marketingConsent"
            defaultChecked={marketingConsent}
            aria-describedby={marketingNote ? "marketingNote" : undefined}
            className="size-5 shrink-0"
          />
          {t.marketingLabel}
        </label>
        {marketingNote && (
          <p id="marketingNote" className="text-sm text-muted-foreground">
            {marketingNote}
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending} className="h-11">
        {t.save}
      </Button>
      {state.status === "saved" && (
        <p role="status" className="text-sm font-medium">
          {t.saved}
        </p>
      )}
      {(state.status === "invalid" || state.status === "error") && (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
          {state.status === "invalid" ? t.invalid : t.error}
        </p>
      )}
    </form>
  );
}
