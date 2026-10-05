import { it } from "@/i18n/it";
import { telHref } from "@/lib/booking/format";

/** Cliente bloccato per la prenotazione online (SPEC §6.7, §12): invito a chiamare il negozio. */
export function BlockedNotice({ phone }: { phone: string | null }) {
  const tel = telHref(phone);
  return (
    <div role="alert" className="flex flex-col gap-3 border border-ink p-4">
      <p>{it.booking.errors.blocked}</p>
      {tel && (
        <a
          href={tel}
          className="inline-flex h-11 w-fit items-center border border-ink px-4 text-sm font-medium hover:bg-ink hover:text-surface"
        >
          {it.booking.list.callShop}
        </a>
      )}
    </div>
  );
}
