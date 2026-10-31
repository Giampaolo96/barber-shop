"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";

type ActionState = { status: string };

/**
 * Pulsante di riga che invia una server action (elimina, su, giù...). I messaggi per stato
 * vengono mostrati accanto al pulsante.
 */
export function RowAction({
  action,
  fields,
  label,
  confirmText,
  messages = {},
  variant = "outline",
  size = "sm",
}: {
  // Firma a metodo: accetta server action con stati più specifici (ServiceRowState...).
  action(previous: ActionState, formData: FormData): Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  confirmText?: string;
  messages?: Partial<Record<string, string>>;
  variant?: "outline" | "destructive" | "destructive-quiet" | "ghost";
  size?: "sm" | "default";
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const message = messages[state.status] ?? (state.status === "error" ? it.admin.common.error : null);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirmText && !window.confirm(confirmText)) event.preventDefault();
      }}
      className="inline-flex flex-col gap-1"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size={size} variant={variant} disabled={pending}>
        {label}
      </Button>
      {message && (
        <p role="alert" className="max-w-xs text-sm text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}
