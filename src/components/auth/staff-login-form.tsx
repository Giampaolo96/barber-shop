"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { staffLogin } from "@/lib/auth/actions";
import type { StaffLoginState } from "@/lib/auth/actions";

export function StaffLoginForm({ disabled }: { disabled: boolean }) {
  const initialState: StaffLoginState = { status: disabled ? "disabled" : "idle" };
  const [state, formAction, pending] = useActionState(staffLogin, initialState);
  const t = it.auth.staffLogin;

  return (
    <form action={formAction} noValidate className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t.emailLabel}</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t.passwordLabel}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {t.submit}
      </Button>
      {state.status === "invalid" && (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
          {t.invalidCredentials}
        </p>
      )}
      {state.status === "disabled" && (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
          {t.accountDisabled}
        </p>
      )}
    </form>
  );
}
