import Link from "next/link";
import { it } from "@/i18n/it";

/** Schermate del flusso: servizio, "Quando?", riepilogo (fetta 8e). */
const BOOKING_STEPS = 3;

/** Intestazione di un passo del flusso di prenotazione (3 schermate, SPEC §5.2). */
export function StepHeader({
  step,
  title,
  subtitle,
  mark,
  backHref,
  compact = false,
}: {
  step: number;
  title: string;
  /** Sottotitolo in corsivo sotto il titolo. */
  subtitle?: string;
  backHref?: string;
} & (
  | {
      /** Segno del tema accanto al titolo (decorativo). */
      mark?: React.ReactNode;
      compact?: false;
    }
  | {
      /** L'intestazione compatta non ha il segno del tema. */
      mark?: never;
      /** Titolo piccolo con il sottotitolo accanto: lascia spazio al contenuto ("Quando?", fetta 8e). */
      compact: true;
    }
)) {
  return (
    <div className={compact ? "flex flex-col" : "flex flex-col gap-2"}>
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
          {it.booking.step.replace("{current}", String(step)).replace("{total}", String(BOOKING_STEPS))}
        </p>
      </div>
      {compact ? (
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="font-display text-3xl leading-tight">{title}</h1>
          {subtitle && <p className="font-display text-base italic text-muted-foreground">{subtitle}</p>}
        </div>
      ) : (
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-5xl leading-none">{title}</h1>
            {subtitle && <p className="font-display text-xl italic text-muted-foreground">{subtitle}</p>}
          </div>
          {mark}
        </div>
      )}
    </div>
  );
}
