import Link from "next/link";
import { it } from "@/i18n/it";

/** Intestazione di un passo del flusso di prenotazione (max 4 schermate, SPEC §5.2). */
export function StepHeader({
  step,
  title,
  backHref,
}: {
  step: number;
  title: string;
  backHref?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        {backHref ? (
          <Link
            href={backHref}
            className="-ml-2 inline-flex h-11 w-fit items-center px-2 text-sm font-medium underline underline-offset-4 hover:no-underline"
          >
            {it.booking.back}
          </Link>
        ) : (
          <span />
        )}
        <p className="text-sm text-muted-foreground tabular-nums">
          {it.booking.step.replace("{current}", String(step)).replace("{total}", "4")}
        </p>
      </div>
      <h1 className="font-display text-4xl leading-tight">{title}</h1>
    </div>
  );
}

/** Voce di scelta a tutta larghezza (servizio, barbiere), tap target ≥ 44px. */
export const choiceClass =
  "flex min-h-16 w-full items-center gap-4 border border-ink px-4 py-3 text-left transition-colors hover:bg-ink hover:text-surface [&:hover_.text-muted-foreground]:text-surface";
