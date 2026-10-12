"use client";

import { useState } from "react";
import {
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

/**
 * Autoscroll solo vicino ai bordi estremi (5% in orizzontale): serve a raggiungere le colonne
 * fuori schermo, ma non deve far scorrere la griglia sotto un puntatore fermo su una colonna
 * visibile. L'anteprima della destinazione segue comunque lo scorrimento.
 */
export const AUTO_SCROLL = { threshold: { x: 0.05, y: 0.2 } };

/**
 * Il rilascio di un trascinamento genera anche un click sulla scheda, che è un link al dettaglio.
 * dnd-kit ne ferma la propagazione (React non lo vede) ma non l'azione predefinita: senza questo
 * blocco il browser aprirebbe il dettaglio. Il click arriva nello stesso task del rilascio, quindi
 * il blocco si toglie subito dopo, così non ne intercetta altri.
 */
const preventClick = (event: Event) => event.preventDefault();
const blockClick = () => window.addEventListener("click", preventClick, { capture: true });
const releaseClick = () => setTimeout(() => window.removeEventListener("click", preventClick, { capture: true }), 0);

/**
 * Trascinamento delle schede nelle griglie del calendario (ADR 008): sensori (mouse dopo 5 px, tocco
 * dopo una pressione di 250 ms, così il dito scorre la griglia senza afferrare), blocco del click al
 * rilascio, scheda afferrata e anteprima della destinazione. `resolve` calcola la destinazione
 * dell'evento con la stessa funzione per l'anteprima e per il rilascio; `previewOf` la trasforma
 * nell'anteprima (null se non c'è destinazione valida); `onDrop` gestisce il rilascio.
 */
export function useCalendarDrag<T, P>({
  resolve,
  previewOf,
  onDrop,
}: {
  resolve: (event: DragMoveEvent | DragEndEvent) => T | null;
  previewOf: (target: T) => P | null;
  onDrop: (target: T) => void;
}) {
  const [preview, setPreview] = useState<P | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const onDragMove = (event: DragMoveEvent) => {
    const target = resolve(event);
    setPreview(target === null ? null : previewOf(target));
  };

  const reset = () => {
    releaseClick();
    setPreview(null);
    setActiveId(null);
  };

  return {
    sensors,
    activeId,
    preview,
    handlers: {
      onDragStart: (event: DragStartEvent) => {
        blockClick();
        setActiveId(String(event.active.id));
      },
      onDragMove,
      onDragOver: onDragMove,
      onDragEnd: (event: DragEndEvent) => {
        reset();
        const target = resolve(event);
        if (target !== null) onDrop(target);
      },
      onDragCancel: reset,
    },
  };
}
