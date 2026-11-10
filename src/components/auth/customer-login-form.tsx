"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { requestMagicLink, verifyLoginCode } from "@/lib/auth/actions";
import type { LoginCodeState, MagicLinkState } from "@/lib/auth/actions";

const RESEND_DELAY_MS = 60_000;
const initialState: MagicLinkState = { status: "idle" };
const initialCodeState: LoginCodeState = { status: "idle" };
const errorClass = "border-l-2 border-destructive pl-3 text-destructive";

/** Invio non riuscito (Supabase lo ha rifiutato): il cliente non deve aspettare un'email. */
function sendErrorText(state: MagicLinkState): string | null {
  if (state.status === "rateLimited") return it.auth.customerLogin.rateLimited;
  if (state.status === "error") return it.auth.customerLogin.sendFailed;
  return null;
}

type Sent = { email: string; at: number };

/**
 * Login del cliente: email, poi codice a 6 cifre (fetta 8). Il codice apre la sessione dove viene
 * digitato, anche nell'app installata; il link nell'email resta un'alternativa.
 * `next`: pagina a cui tornare dopo l'accesso (già validata con safeNextPath).
 */
export function CustomerLoginForm({ next = "/" }: { next?: string }) {
  const [sent, setSent] = useState<Sent | null>(null);
  // Esito già visto prima di "Usa un'altra email": il suo errore non si ripete sul modulo nuovo.
  const [dismissed, setDismissed] = useState<MagicLinkState | null>(null);
  const [state, formAction, pending] = useActionState(
    async (previous: MagicLinkState, formData: FormData) => {
      const result = await requestMagicLink(previous, formData);
      if (result.status === "sent") setSent({ email: String(formData.get("email") ?? ""), at: Date.now() });
      return result;
    },
    initialState,
  );
  const t = it.auth.customerLogin;
  const sendError = state === dismissed ? null : sendErrorText(state);

  if (sent) {
    return (
      <div className="flex w-full flex-col gap-4">
        <p role="status">{t.linkSent}</p>
        {/* Nuovo invio: il modulo del codice riparte da capo. */}
        <LoginCodeForm key={sent.at} email={sent.email} next={next} />
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="email" value={sent.email} />
          {next !== "/" && <input type="hidden" name="next" value={next} />}
          <ResendButton sentAt={sent.at} pending={pending} />
          {sendError && (
            <p role="alert" className={errorClass}>
              {sendError}
            </p>
          )}
        </form>
        <Button
          type="button"
          variant="link"
          className="h-11 w-fit px-0"
          onClick={() => {
            setSent(null);
            setDismissed(state);
          }}
        >
          {it.auth.loginCode.changeEmail}
        </Button>
      </div>
    );
  }

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
          placeholder={t.emailPlaceholder}
          required
          aria-invalid={state.status === "invalid"}
          className="h-11"
        />
      </div>
      <Button type="submit" disabled={pending} className="h-11">
        {t.submit}
      </Button>
      {state.status === "invalid" && (
        <p role="alert" className={errorClass}>
          {t.invalidEmail}
        </p>
      )}
      {sendError && (
        <p role="alert" className={errorClass}>
          {sendError}
        </p>
      )}
    </form>
  );
}

function LoginCodeForm({ email, next }: { email: string; next: string }) {
  const [state, formAction, pending] = useActionState(verifyLoginCode, initialCodeState);
  const t = it.auth.loginCode;
  const message =
    state.status === "wrong"
      ? fillText(t.invalid, { remaining: state.remaining })
      : state.status === "blocked"
        ? t.blocked
        : state.status === "rateLimited"
          ? t.rateLimited
          : state.status === "sessionFailed"
            ? t.sessionFailed
            : state.status === "invalid"
              ? t.invalidFormat
              : null;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="email" value={email} />
      {next !== "/" && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-2">
        <Label htmlFor="token">{t.label}</Label>
        <Input
          id="token"
          name="token"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          aria-invalid={message !== null}
          aria-describedby={message ? "token-error" : undefined}
          className="h-11 text-lg tracking-[0.3em] tabular-nums"
        />
      </div>
      <Button type="submit" disabled={pending} className="h-11">
        {t.submit}
      </Button>
      {message && (
        <p id="token-error" role="alert" className={errorClass}>
          {message}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t.linkStillWorks}</p>
    </form>
  );
}

/** "Invia di nuovo" si attiva 60 secondi dopo l'ultimo invio. */
function ResendButton({ sentAt, pending }: { sentAt: number; pending: boolean }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), Math.max(0, sentAt + RESEND_DELAY_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [sentAt]);

  return (
    <Button type="submit" variant="outline" disabled={!ready || pending} className="h-11 w-fit">
      {it.auth.loginCode.resend}
    </Button>
  );
}
