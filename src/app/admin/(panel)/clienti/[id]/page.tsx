import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { CustomerStatusBadges } from "@/components/admin/customers/status-badges";
import { RowAction } from "@/components/admin/row-action";
import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { requireRole } from "@/lib/auth/current-user";
import { bookingDetailPath } from "@/lib/calendar/paths";
import { resetNoShows, setCustomerBlocked } from "@/lib/customers/actions";
import { CUSTOMERS_PATH } from "@/lib/customers/paths";
import { getCustomer, getCustomerBookings, getNoShowSettings, HISTORY_LIMIT } from "@/lib/customers/queries";
import { customerIdSchema } from "@/lib/customers/schemas";
import { createClient } from "@/lib/db/server";
import { formatCents } from "@/lib/domain/money";

const t = it.admin.customers;

const ACTION_MESSAGES: Partial<Record<string, string>> = {
  invalid: it.admin.common.invalid,
  forbidden: t.forbidden,
  error: it.admin.common.error,
};

// Scheda di un cliente (SPEC §6.7): dati, stato del blocco, contatore no-show, storico. Solo admin;
// un id che non è un cliente è un 404.
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const parsed = customerIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  const supabase = await createClient();
  const customer = await getCustomer(supabase, parsed.data);
  if (!customer) notFound();
  const [{ timezone, threshold }, { bookings, truncated }] = await Promise.all([
    getNoShowSettings(supabase),
    getCustomerBookings(supabase, customer.id),
  ]);

  const dateTime = (instant: Date) => formatInTimeZone(instant, timezone, "dd/MM/yyyy HH:mm");
  const rows: Array<[string, string]> = [
    [t.phone, customer.phone ?? "—"],
    [t.email, customer.email ?? "—"],
    [t.registeredAt, formatInTimeZone(customer.createdAt, timezone, "dd/MM/yyyy")],
    [t.noShowCount, String(customer.noShowCount)],
  ];
  if (customer.noShowResetAt) {
    rows.push([
      t.lastReset,
      fillText(t.lastResetValue, { date: dateTime(customer.noShowResetAt), name: customer.noShowResetBy ?? "—" }),
    ]);
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href={CUSTOMERS_PATH} className="text-sm underline underline-offset-4">
        {t.backToList}
      </Link>
      <h1 className="font-display text-4xl leading-tight">{customer.fullName ?? t.noName}</h1>

      <dl className="grid max-w-lg grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-medium">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.statusTitle}</h2>
        <div className="text-sm">
          <CustomerStatusBadges customer={customer} threshold={threshold} />
        </div>
        <p className="text-xs text-muted-foreground">{t.blockHint}</p>
        <div className="flex flex-wrap gap-2">
          <RowAction
            action={setCustomerBlocked}
            fields={{ customerId: customer.id, blocked: customer.isBlocked ? "false" : "true" }}
            label={customer.isBlocked ? t.unblock : t.block}
            confirmText={customer.isBlocked ? undefined : t.confirmBlock}
            messages={ACTION_MESSAGES}
            variant={customer.isBlocked ? "outline" : "destructive"}
          />
          {customer.noShowCount > 0 && (
            <RowAction
              action={resetNoShows}
              fields={{ customerId: customer.id }}
              label={t.resetNoShows}
              confirmText={t.confirmReset}
              messages={ACTION_MESSAGES}
            />
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.historyTitle}</h2>
        {bookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.historyEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4">{t.when}</th>
                  <th className="py-2 pr-4">{t.service}</th>
                  <th className="py-2 pr-4">{t.barber}</th>
                  <th className="py-2 pr-4">{t.price}</th>
                  <th className="py-2">{t.bookingStatus}</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.id} className="border-b align-top">
                    <td className="py-2 pr-4">
                      <Link href={bookingDetailPath(booking.id)} className="underline underline-offset-4">
                        {dateTime(booking.startsAt)}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{booking.serviceName}</td>
                    <td className="py-2 pr-4">{booking.barberName}</td>
                    <td className="py-2 pr-4">{formatCents(booking.priceCents)}</td>
                    <td className="py-2">{it.admin.calendar.statusLabels[booking.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {truncated && <p className="text-sm text-muted-foreground">{fillText(t.historyTruncated, { count: HISTORY_LIMIT })}</p>}
      </section>
    </div>
  );
}
