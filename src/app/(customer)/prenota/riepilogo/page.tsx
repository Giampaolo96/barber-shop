import { z } from "zod";
import { AccessNotice } from "@/components/booking/access-notice";
import { ConfirmBookingForm } from "@/components/booking/confirm-booking-form";
import { RestartNotice } from "@/components/booking/restart-notice";
import { StepHeader } from "@/components/booking/step-header";
import { it } from "@/i18n/it";
import { formatDateTime, formatDuration } from "@/lib/booking/format";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { ANY_BARBER, BOOK_PATH, summaryStepUrl, whenStepUrl } from "@/lib/booking/paths";
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
  const { shop, access } = await loadBookingPageContext();
  const t = it.booking.summary;
  const params = paramsSchema.safeParse(await searchParams);

  const service = params.success ? await getBookableService(params.data.servizio) : null;
  const barbers = service ? await getBarbersForService(service.id) : [];
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
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 border border-ink p-5">
            <dt className="text-muted-foreground">{t.service}</dt>
            <dd className="font-medium">{service.name}</dd>
            <dt className="text-muted-foreground">{t.barber}</dt>
            <dd className="font-medium">{barberName}</dd>
            <dt className="text-muted-foreground">{t.when}</dt>
            <dd className="font-display text-2xl leading-tight first-letter:uppercase">
              {formatDateTime(params.data.inizio, shop.timezone)}
            </dd>
            <dt className="text-muted-foreground">{t.price}</dt>
            <dd className="font-medium">
              {formatCents(service.priceCents)},{" "}
              {formatDuration(service.durationMin)}
            </dd>
          </dl>
          {access !== "ok" ? (
            <AccessNotice
              access={access}
              phone={shop.phone}
              retryHref={summaryStepUrl(service.id, barberId, params.data.inizio, preferredId)}
            />
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
