import { it } from "@/i18n/it";
import { countText } from "@/lib/admin/text";

/** Esito comune dei moduli dell'area admin: salvato, dati non validi, errore. */
export function FormStatus({ status }: { status: string }) {
  if (status === "saved") {
    return (
      <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
        {it.admin.common.saved}
      </p>
    );
  }
  if (status === "invalid" || status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {status === "invalid" ? it.admin.common.invalid : it.admin.common.error}
      </p>
    );
  }
  return null;
}

/** Avviso non bloccante (es. prenotazioni coinvolte da una disattivazione). */
export function FormWarning({ children }: { children: string }) {
  return (
    <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      {children}
    </p>
  );
}

/**
 * Avviso sulle prenotazioni coinvolte da un salvataggio: niente se sono zero, il numero al
 * singolare o al plurale, oppure un avviso generico se il conteggio non è riuscito (`null`).
 */
export function BookingsWarning({
  status,
  count,
  one,
  other,
}: {
  status: string;
  count: number | null | undefined;
  one: string;
  other: string;
}) {
  if (status !== "saved" || count === undefined || count === 0) return null;
  return <FormWarning>{count === null ? it.admin.common.bookingsUnverified : countText(count, one, other)}</FormWarning>;
}
