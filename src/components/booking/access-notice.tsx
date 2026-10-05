import Link from "next/link";
import { it } from "@/i18n/it";
import { BlockedNotice } from "./blocked-notice";

/**
 * Avviso al posto del flusso quando il cliente non può prenotare: bloccato (invito a chiamare il
 * negozio) oppure profilo non leggibile (invito a riprovare). `retryHref`: la pagina corrente.
 */
export function AccessNotice({
  access,
  phone,
  retryHref,
}: {
  access: "blocked" | "error";
  phone: string | null;
  retryHref: string;
}) {
  if (access === "blocked") return <BlockedNotice phone={phone} />;
  return (
    <div role="alert" className="flex flex-col gap-3 border border-ink p-4">
      <p>{it.booking.errors.profileLoad}</p>
      <Link
        href={retryHref}
        className="inline-flex h-11 w-fit items-center border border-ink px-4 text-sm font-medium hover:bg-ink hover:text-surface"
      >
        {it.booking.errors.retry}
      </Link>
    </div>
  );
}
