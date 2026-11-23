"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { type DeleteAccountState, deleteAccount } from "@/lib/auth/account-actions";

const initialState: DeleteAccountState = { status: "idle" };

/** Eliminazione in due passi (fetta 9b): "Continua" mostra il pulsante che elimina davvero. */
export function DeleteAccountForm() {
  const [state, formAction, pending] = useActionState(deleteAccount, initialState);
  const [step, setStep] = useState<"review" | "confirm">("review");
  const t = it.profile.deletion;

  if (step === "review") {
    return (
      <Button type="button" variant="outline" className="h-11 w-fit" onClick={() => setStep("confirm")}>
        {t.proceed}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Button type="submit" variant="destructive" disabled={pending} className="h-11 w-fit">
        {t.confirm}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
          {t.error}
        </p>
      )}
    </form>
  );
}
