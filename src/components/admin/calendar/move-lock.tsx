"use client";

import Link from "next/link";
import { useSyncExternalStore, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Spostamento in corso nel calendario (una griglia montata alla volta). Una navigazione di Next
// scarta la server action in volo e la sua risposta non arriva mai (ADR 008, aggiornamento 8h):
// finché lo spostamento non ha un esito, i comandi che cambiano giorno o vista non navigano.
let busy = false;
const listeners = new Set<() => void>();

export function setMoveBusy(value: boolean): void {
  if (busy === value) return;
  busy = value;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useMoveBusy(): boolean {
  return useSyncExternalStore(subscribe, () => busy, () => false);
}

/** Link della barra del calendario: con uno spostamento in corso è aria-disabled e non naviga. */
export function CalendarNavLink({ onClick, className, ...props }: ComponentProps<typeof Link>) {
  const locked = useMoveBusy();
  return (
    <Link
      {...props}
      aria-disabled={locked || undefined}
      className={cn(className, locked && "cursor-not-allowed opacity-50")}
      onClick={(event) => {
        if (locked) event.preventDefault();
        else onClick?.(event);
      }}
    />
  );
}
