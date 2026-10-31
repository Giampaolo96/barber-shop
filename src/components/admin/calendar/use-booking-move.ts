"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { it } from "@/i18n/it";
import { moveBooking } from "@/lib/calendar/actions";
import type { WarningCode } from "@/lib/calendar/warnings";
import { CALENDAR_ERROR_TEXT } from "./messages";

const t = it.admin.calendar.move;
/** Per quanto resta disponibile "Annulla spostamento" (decisione fetta 6c). */
const UNDO_MS = 8_000;

export type Position = { barberId: string; startsAt: Date };

type Move = { id: string; from: Position; to: Position; confirmedWarnings: WarningCode[] };
type Kind = "move" | "undo";

/** `success` sparisce da solo, `error` resta finché non si chiude, `progress` lo sostituisce l'esito. */
export type MoveNotice = { text: string; tone: "progress" | "success" | "error"; undo?: () => void };
export type MoveDialog = { warnings: WarningCode[]; confirm: () => void; cancel: () => void };

/**
 * Spostamento dal calendario (fetta 6c): la scheda si sposta subito (ottimistico) e torna al suo
 * posto se il server rifiuta. Gli avvisi aprono un dialogo; dopo il salvataggio "Annulla
 * spostamento" richiama il server all'indietro con gli avvisi della posizione di partenza già
 * confermati (se ne compare uno nuovo, si chiede di nuovo conferma).
 * Le posizioni ottimistiche valgono solo per i dati con cui sono nate (`base`): quando la pagina
 * si aggiorna con i dati salvati spariscono da sole.
 */
export function useBookingMove<T>(base: T) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<{ base: T; positions: Record<string, Position> }>({
    base,
    positions: {},
  });
  const [notice, setNotice] = useState<MoveNotice | null>(null);
  const [dialog, setDialog] = useState<MoveDialog | null>(null);
  const [busy, setBusy] = useState(false);
  // Dati attuali anche per le azioni nate in un rendering precedente (es. l'annullamento).
  const latestBase = useRef(base);
  useEffect(() => {
    latestBase.current = base;
  }, [base]);

  // "Annulla spostamento" scade: resta solo il messaggio, che dopo lo stesso tempo sparisce.
  useEffect(() => {
    if (notice?.tone !== "success") return;
    const timer = setTimeout(
      () => setNotice((current) => (current?.undo ? { text: current.text, tone: current.tone } : null)),
      UNDO_MS,
    );
    return () => clearTimeout(timer);
  }, [notice]);

  const place = (id: string, position: Position | null) =>
    setOptimistic((current) => {
      const now = latestBase.current;
      const positions = current.base === now ? { ...current.positions } : {};
      if (position) positions[id] = position;
      else delete positions[id];
      return { base: now, positions };
    });

  const run = async (move: Move, kind: Kind): Promise<void> => {
    setDialog(null);
    setBusy(true);
    place(move.id, move.to);
    setNotice({ text: t.saving, tone: "progress" });
    try {
      const result = await moveBooking({
        id: move.id,
        barberId: move.to.barberId,
        startsAt: move.to.startsAt.toISOString(),
        expectedBarberId: move.from.barberId,
        expectedStartsAt: move.from.startsAt.toISOString(),
        confirmedWarnings: move.confirmedWarnings,
      });
      if (result.status === "saved") {
        const back: Move = { id: move.id, from: move.to, to: move.from, confirmedWarnings: result.previousWarnings };
        setNotice(
          kind === "move"
            ? { text: t.saved, tone: "success", undo: () => void run(back, "undo") }
            : { text: t.undone, tone: "success" },
        );
        return;
      }
      if (result.status === "warnings") {
        setNotice(null);
        setDialog({
          warnings: result.warnings,
          confirm: () => void run({ ...move, confirmedWarnings: result.warnings }, kind),
          cancel: () => {
            setDialog(null);
            place(move.id, null);
          },
        });
        return;
      }
      place(move.id, null);
      setNotice({ text: CALENDAR_ERROR_TEXT[result.status] ?? t.error, tone: "error" });
      // Dati cambiati nel frattempo: si ricarica il calendario.
      if (result.status === "stale") router.refresh();
    } catch (error) {
      console.error("moveBooking", error);
      place(move.id, null);
      setNotice({ text: t.error, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return {
    positions: optimistic.base === base ? optimistic.positions : {},
    notice,
    dialog,
    busy,
    move: (id: string, from: Position, to: Position) => void run({ id, from, to, confirmedWarnings: [] }, "move"),
    /** Spostamento rifiutato prima di chiamare il server (es. verso il passato). */
    reject: (text: string) => setNotice({ text, tone: "error" }),
    dismiss: () => setNotice(null),
  };
}
