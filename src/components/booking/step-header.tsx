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
    <div className="flex flex-col gap-1">
      {backHref && (
        <Link
          href={backHref}
          className="-ml-2 inline-flex h-11 w-fit items-center rounded-lg px-2 text-sm font-medium"
        >
          ← {it.booking.back}
        </Link>
      )}
      <p className="text-sm opacity-70">
        {it.booking.step.replace("{current}", String(step)).replace("{total}", "4")}
      </p>
      <h1 className="text-2xl font-semibold">{title}</h1>
    </div>
  );
}

/** Voce di scelta a tutta larghezza (servizio, barbiere), tap target ≥ 44px. */
export const choiceClass =
  "flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left active:bg-muted";
