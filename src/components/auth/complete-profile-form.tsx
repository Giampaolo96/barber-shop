"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { completeProfile } from "@/lib/auth/actions";
import type { CompleteProfileState } from "@/lib/auth/actions";

const initialState: CompleteProfileState = { status: "idle" };

/** `next`: pagina a cui tornare dopo il salvataggio (già validata con safeNextPath). */
export function CompleteProfileForm({
  fullName,
  phone,
  next = "/",
}: {
  fullName: string;
  phone: string;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(completeProfile, initialState);
  const t = it.auth.completeProfile;

  return (
    <form action={formAction} noValidate className="flex w-full flex-col gap-4">
      {next !== "/" && <input type="hidden" name="next" value={next} />}
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
      {/* Consensi mai preselezionati (SPEC §8). */}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="privacyConsent" required className="size-5 shrink-0" />
        {t.privacyConsentLabel}
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="marketingConsent" className="size-5 shrink-0" />
        {t.marketingConsentLabel}
      </label>
      <Button type="submit" disabled={pending} className="h-11">
        {t.submit}
      </Button>
      {state.status === "invalid" && (
        <p role="alert" className="text-destructive">
          {t.invalid}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-destructive">
          {t.error}
        </p>
      )}
    </form>
  );
}
