"use client";

import { useLinkStatus } from "next/link";
import { PendingMark } from "@/themes/active";

/**
 * Riscontro al tocco (docs/DESIGN.md): dentro un <Link> con `relative`, mentre si apre la pagina il
 * link diventa pieno con il segno del tema. Sovrapposto al link, non sposta nulla; il segno si muove
 * solo se il movimento è ammesso (classe del tema). Segue gli angoli del link (caselle arrotondate, fetta 8f).
 */
export function LinkPending({ markClassName = "size-6" }: { markClassName?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span aria-hidden="true" className="glow absolute inset-0 flex rounded-[inherit] items-center justify-center bg-ink text-surface">
      <PendingMark className={markClassName} />
    </span>
  );
}
