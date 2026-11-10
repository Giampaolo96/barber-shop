import { z } from "zod";
import { BlockedNotice } from "@/components/booking/blocked-notice";
import { ConfirmBookingForm } from "@/components/booking/confirm-booking-form";
import { RestartNotice } from "@/components/booking/restart-notice";
import { StepHeader } from "@/components/booking/step-header";
import { it } from "@/i18n/it";
import { formatDateTime, formatDuration } from "@/lib/booking/format";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { ANY_BARBER, BOOK_PATH, whenStepUrl } from "@/lib/booking/paths";
import { getBarbersForService, getBookableService } from "@/lib/booking/queries";
import { barberChoiceSchema } from "@/lib/booking/schemas";
import { localDateOf } from "@/lib/domain/local-time";
import { formatCents } from "@/lib/domain/money";

const paramsSchema = z.object({
  servizio: z.uuid(),
  barbiere: barberChoiceSchema,
  inizio: z.iso.datetime({ offset: true }),
  /** Barbiere preferito arrivato su "Quando?" (fetta 8e): torna con "Indietro" e "Cambia orario". */
  preferito: z.uuid().optional().catch(undefined),
});

// Passo 3 di 3 (SPEC §5.2): riepilogo, nota facoltativa e conferma. Lo slot lo ricontrolla il
// database alla conferma (create_online_booking).
export default async function BookingSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const t = it.booking.summary;
  const params = paramsSchema.safeParse(await searchParams);
  const serviceId = params.success ? params.data.servizio : null;

  // Servizio e barbieri dipendono solo dall'URL: si leggono insieme ai controlli di accesso e la
  // pagina mostra qualcosa solo dopo requireRole (in loadBookingPageContext).
  const [{ shop, access }, service, serviceBarbers] = await Promise.all([
    loadBookingPageContext(),
    serviceId ? getBookableService(serviceId) : null,
    serviceId ? getBarbersForService(serviceId) : [],
  ]);
  const barbers = service ? serviceBarbers : [];
  const barberId = params.success ? params.data.barbiere : ANY_BARBER;
  const barberName =
    barberId === ANY_BARBER
      ? t.anyBarber
      : barbers.find((barber) => barber.id === barberId)?.name;
  // "Indietro" e "Cambia orario": di nuovo "Quando?" sullo stesso giorno, con il preferito (fetta 8e).
  const preferredId = params.success ? params.data.preferito : undefined;
  const timeHref =
    service && params.success
      ? whenStepUrl(service.id, {
          day: localDateOf(new Date(params.data.inizio), shop.timezone),
          barberId: preferredId,
        })
      : service
        ? whenStepUrl(service.id)
        : BOOK_PATH;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <StepHeader step={3} title={t.title} backHref={timeHref} />
      {!params.success || !service || !barberName ? (
        <RestartNotice />
      ) : (
        <>
          {/* Etichette sulla prima riga del valore ("Quando" va su due righe), più respiro fra le voci (fetta 8k). */}
          <dl className="glass grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-4 border border-(--glass-border) p-5">
            <dt className="text-muted-foreground">{t.service}</dt>
            <dd className="font-medium">{service.name}</dd>
            <dt className="text-muted-foreground">{t.barber}</dt>
            <dd className="font-medium">{barberName}</dd>
            <dt className="text-muted-foreground">{t.when}</dt>
            <dd className="font-display text-2xl leading-tight text-glow first-letter:uppercase">
              {formatDateTime(params.data.inizio, shop.timezone)}
            </dd>
            <dt className="text-muted-foreground">{t.price}</dt>
            <dd className="font-medium tabular-nums">{formatCents(service.priceCents)}</dd>
            <dt className="text-muted-foreground">{t.duration}</dt>
            <dd className="font-medium tabular-nums">{formatDuration(service.durationMin)}</dd>
          </dl>
          {access !== "ok" ? (
            <BlockedNotice phone={shop.phone} />
          ) : (
            <ConfirmBookingForm
              serviceId={service.id}
              barberId={barberId}
              startsAt={params.data.inizio}
              changeTimeHref={timeHref}
            />
          )}
        </>
      )}
    </main>
  );
}
