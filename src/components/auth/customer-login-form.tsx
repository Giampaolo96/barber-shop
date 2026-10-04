"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { requestMagicLink } from "@/lib/auth/actions";
import type { MagicLinkState } from "@/lib/auth/actions";

const initialState: MagicLinkState = { status: "idle" };

/** `next`: pagina a cui tornare dopo il link (già validata con safeNextPath). */
export function CustomerLoginForm({ next = "/" }: { next?: string }) {
  const [state, formAction, pending] = useActionState(requestMagicLink, initialState);
  const t = it.auth.customerLogin;

  return (
    <form action={formAction} noValidate className="flex w-full flex-col gap-4">
      {next !== "/" && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t.emailLabel}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          aria-invalid={state.status === "invalid"}
          className="h-11"
        />
      </div>
      <Button type="submit" disabled={pending} className="h-11">
        {t.submit}
      </Button>
      {state.status === "sent" && <p role="status">{t.linkSent}</p>}
      {state.status === "invalid" && (
        <p role="alert" className="text-destructive">
          {t.invalidEmail}
        </p>
      )}
    </form>
  );
}
