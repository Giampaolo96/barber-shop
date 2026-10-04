import Link from "next/link";
import { it } from "@/i18n/it";
import { BOOK_PATH } from "@/lib/booking/paths";

/** Parametri del flusso non validi o scelta non più disponibile: si ricomincia dal servizio. */
export function RestartNotice() {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border p-4">
      <p>{it.booking.summary.unavailable}</p>
      <Link
        href={BOOK_PATH}
        className="inline-flex h-11 w-fit items-center rounded-lg border px-4 text-sm font-medium"
      >
        {it.booking.summary.restart}
      </Link>
    </div>
  );
}
