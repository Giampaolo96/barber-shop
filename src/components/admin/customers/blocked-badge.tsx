import type { ReactNode } from "react";

/** Etichetta di un cliente bloccato (sezione Clienti e ricerca della prenotazione manuale). */
export function BlockedBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">{children}</span>
  );
}
