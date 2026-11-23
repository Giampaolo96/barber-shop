"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { acceptPrivacyUpdate, type ReconsentState } from "@/lib/auth/account-actions";

const initialState: ReconsentState = { status: "idle" };

/** Nuovo consenso all'informativa cambiata; `next` già validato con safeNextPath. */
export function ReconsentForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(acceptPrivacyUpdate, initialState);
  const t = it.auth.reconsent;

  return (
    <form action={formAction} noValidate className="flex w-full flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      {/* Mai preselezionata (SPEC §8). */}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="privacyConsent" required className="size-5 shrink-0" />
        {t.checkboxLabel}
      </label>
      <Button type="submit" disabled={pending} className="h-11">
        {t.submit}
      </Button>
      {state.status !== "idle" && (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
          {state.status === "invalid" ? t.invalid : t.error}
        </p>
      )}
    </form>
  );
}
