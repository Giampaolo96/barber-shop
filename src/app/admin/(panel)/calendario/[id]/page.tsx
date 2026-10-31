import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { CALENDAR_ERROR_TEXT } from "@/components/admin/calendar/messages";
import { EditBookingForm } from "@/components/admin/calendar/edit-booking-form";
import { MoveBookingForm } from "@/components/admin/calendar/move-booking-form";
import { StaffNoteForm } from "@/components/admin/calendar/staff-note-form";
import { RowAction } from "@/components/admin/row-action";
import { it } from "@/i18n/it";
import { getOwnBarberId } from "@/lib/admin/queries";
import { idSchema } from "@/lib/admin/schemas";
import { requireRole } from "@/lib/auth/current-user";
import { formatDateTime, formatDayLabel, formatTime } from "@/lib/booking/format";
import { changeBookingStatus } from "@/lib/calendar/actions";
import { canDrag } from "@/lib/calendar/move";
import { CREATED_PARAM } from "@/lib/calendar/paths";
import { getBarbers, getBookingDetail, getCalendarSettings, getServices } from "@/lib/calendar/queries";
import { allowedTransitions, type BookingStatus } from "@/lib/calendar/transitions";
import { calendarHref } from "@/lib/calendar/view";
import { createClient } from "@/lib/db/server";
import { centsToInput, formatCents } from "@/lib/domain/money";
import { localDateOf } from "@/lib/domain/local-time";

const t = it.admin.calendar;

/** Pulsante per ogni stato di arrivo (SPEC §3.6). */
const TRANSITION_LABEL: Record<BookingStatus, string> = {
  completed: t.status.markCompleted,
  no_show: t.status.markNoShow,
  cancelled_by_customer: t.status.cancelByCustomer,
  cancelled_by_shop: t.status.cancelByShop,
  confirmed: t.status.restore,
};

// Dettaglio di una prenotazione (SPEC §6.1, §6.3): stato, nota interna e, solo per l'admin,
// spostamento e modifica; per il barbiere lo spostamento dell'orario delle proprie (fetta 6c).
// Una prenotazione che la RLS non mostra all'utente è un 404.
export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(["barber", "admin"]);
  const parsed = idSchema.safeParse({ id: (await params).id });
  if (!parsed.success) notFound();

  const supabase = await createClient();
  const booking = await getBookingDetail(supabase, parsed.data.id);
  if (!booking) notFound();

  const { timezone } = await getCalendarSettings(supabase);
  const isAdmin = user.role === "admin";
  const now = new Date();
  const transitions = allowedTransitions({
    role: isAdmin ? "admin" : "barber",
    status: booking.status,
    startsAt: booking.startsAt,
    now,
  });
  // Il barbiere sposta l'orario delle proprie confirmed future (fetta 6c); l'admin ha la modifica.
  const canMove =
    !isAdmin &&
    canDrag({
      role: "barber",
      status: booking.status,
      startsAt: booking.startsAt,
      now,
      isOwn: (await getOwnBarberId(supabase)) === booking.barberId,
    });
  const created = (await searchParams)[CREATED_PARAM] === "1";
  const date = localDateOf(booking.startsAt, timezone);

  // Nel modulo dell'admin restano scelti barbiere e servizio attuali anche se disattivati.
  const [barbers, services] = isAdmin
    ? await Promise.all([getBarbers(supabase), getServices(supabase)])
    : [[], []];

  const rows: Array<[string, ReactNode]> = [
    [t.detail.when, `${formatDateTime(booking.startsAt, timezone)}–${formatTime(booking.endsAt, timezone)}`],
    [t.detail.barber, booking.barberName],
    [t.detail.service, booking.serviceName],
    [t.detail.customer, booking.isGuest ? `${booking.customerName} (${t.detail.guest})` : booking.customerName],
    [
      t.detail.phone,
      booking.customerPhone ? (
        <a
          href={`tel:${booking.customerPhone.replace(/\s/g, "")}`}
          className="inline-flex min-h-11 items-center underline underline-offset-4 md:min-h-0"
        >
          {booking.customerPhone}
        </a>
      ) : (
        "—"
      ),
    ],
    [t.detail.duration, t.detail.minutes.replace("{count}", String(booking.durationMin))],
    [t.detail.price, formatCents(booking.priceCents)],
    [t.detail.status, t.statusLabels[booking.status]],
    [t.detail.source, booking.source === "online" ? t.sourceLabels.online : t.sourceLabels.manual],
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href={calendarHref({ date })} className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4">
        {t.detail.backToCalendar}
      </Link>
      <h1 className="font-display text-4xl leading-tight first-letter:uppercase">
        {formatDayLabel(date)}, {formatTime(booking.startsAt, timezone)}, {booking.customerName}
      </h1>
      {created && (
        <p role="status" className="text-sm font-medium">
          {t.detail.created}
        </p>
      )}

      <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
      <dl className="grid max-w-lg grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-medium">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {booking.customerNote && (
          <div className="contents">
            <dt className="font-medium">{t.detail.customerNote}</dt>
            <dd className="whitespace-pre-line">{booking.customerNote}</dd>
          </div>
        )}
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t.detail.statusTitle}</h2>
        {transitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.detail.noTransitions}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {transitions.map((status) => (
              <RowAction
                key={status}
                action={changeBookingStatus}
                fields={{ id: booking.id, status, expectedStatus: booking.status }}
                label={TRANSITION_LABEL[status]}
                messages={CALENDAR_ERROR_TEXT}
                variant={status.startsWith("cancelled") ? "destructive" : "outline"}
              />
            ))}
          </div>
        )}
      </section>

      <StaffNoteForm bookingId={booking.id} note={booking.staffNote} />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
      {canMove && (
        <MoveBookingForm
          id={booking.id}
          barberId={booking.barberId}
          startsAt={booking.startsAt.toISOString()}
          date={date}
          time={formatInTimeZone(booking.startsAt, timezone, "HH:mm")}
        />
      )}

      {isAdmin && (
        <EditBookingForm
          barbers={barbers
            .filter((barber) => barber.isActive || barber.id === booking.barberId)
            .map((barber) => ({ id: barber.id, label: barber.displayName }))}
          services={services
            .filter((service) => service.isActive || service.id === booking.serviceId)
            .map((service) => ({ id: service.id, label: service.name }))}
          defaults={{
            id: booking.id,
            barberId: booking.barberId,
            serviceId: booking.serviceId,
            date,
            time: formatInTimeZone(booking.startsAt, timezone, "HH:mm"),
            durationMin: String(booking.durationMin),
            price: centsToInput(booking.priceCents),
          }}
        />
      )}
        </div>
      </div>
    </div>
  );
}
