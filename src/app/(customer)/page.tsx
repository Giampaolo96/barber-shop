import Link from "next/link";
import { it } from "@/i18n/it";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/booking/format";
import { BOOK_PATH, MY_BOOKINGS_PATH } from "@/lib/booking/paths";
import { getNextBooking, getShopInfo } from "@/lib/booking/queries";

// Home (SPEC §5.1): info del negozio, pulsante "Prenota", prossima prenotazione del cliente.
export default async function HomePage() {
  const [user, shop] = await Promise.all([getCurrentUser(), getShopInfo()]);
  const next = user?.role === "customer" ? await getNextBooking(user.id) : null;
  const t = it.home;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
      <section className="flex flex-col gap-1 pt-4 text-center">
        <h1 className="text-3xl font-semibold">{shop?.name ?? it.shop.name}</h1>
        {shop?.address && <p className="opacity-70">{shop.address}</p>}
        {shop?.phone && (
          <a href={`tel:${shop.phone.replace(/[^\d+]/g, "")}`} className="inline-flex h-11 items-center justify-center">
            {shop.phone}
          </a>
        )}
      </section>

      <Link
        href={BOOK_PATH}
        className="flex h-12 items-center justify-center rounded-xl bg-primary text-base font-medium text-primary-foreground"
      >
        {t.book}
      </Link>

      {user?.role === "customer" && (
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="font-semibold">{t.nextBooking}</h2>
          {next && shop ? (
            <p>
              <span className="font-medium">{next.serviceName}</span> · {next.barberName}
              <br />
              <span className="first-letter:uppercase">{formatDateTime(next.startsAt, shop.timezone)}</span>
            </p>
          ) : (
            <p className="opacity-70">{t.noBooking}</p>
          )}
          <Link href={MY_BOOKINGS_PATH} className="inline-flex h-11 items-center text-sm font-medium underline">
            {t.myBookings}
          </Link>
        </section>
      )}
    </main>
  );
}
