import Link from "next/link";
import { it } from "@/i18n/it";

/** Intestazione di un passo del flusso di prenotazione (max 4 schermate, SPEC §5.2). */
export function StepHeader({
  step,
  title,
  subtitle,
  mark,
  backHref,
}: {
  step: number;
  title: string;
  /** Sottotitolo in corsivo sotto il titolo. */
  subtitle?: string;
  /** Segno del tema accanto al titolo (decorativo). */
  mark?: React.ReactNode;
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
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-5xl leading-none">{title}</h1>
          {subtitle && <p className="font-display text-xl italic text-muted-foreground">{subtitle}</p>}
        </div>
        {mark}
      </div>
    </div>
  );
}
