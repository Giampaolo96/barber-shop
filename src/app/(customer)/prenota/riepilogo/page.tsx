import { z } from "zod";
import { AccessNotice } from "@/components/booking/access-notice";
import { ConfirmBookingForm } from "@/components/booking/confirm-booking-form";
import { RestartNotice } from "@/components/booking/restart-notice";
import { StepHeader } from "@/components/booking/step-header";
import { it } from "@/i18n/it";
import { formatDateTime } from "@/lib/booking/format";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { ANY_BARBER, BOOK_PATH, summaryStepUrl, timeStepUrl } from "@/lib/booking/paths";
import { getBarbersForService, getBookableService } from "@/lib/booking/queries";
import { barberChoiceSchema } from "@/lib/booking/schemas";
import { formatCents } from "@/lib/domain/money";

const paramsSchema = z.object({
  servizio: z.uuid(),
  barbiere: barberChoiceSchema,
  inizio: z.iso.datetime({ offset: true }),
});

// Passo 4 di 4 (SPEC §5.2): riepilogo, nota facoltativa e conferma. Lo slot lo ricontrolla il
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
      ? it.booking.barber.any
      : barbers.find((barber) => barber.id === barberId)?.name;
  const timeHref = service ? timeStepUrl(service.id, barberId) : BOOK_PATH;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <StepHeader step={4} title={t.title} backHref={timeHref} />
      {!params.success || !service || !barberName ? (
        <RestartNotice />
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border p-4">
            <dt className="opacity-70">{t.service}</dt>
            <dd className="font-medium">{service.name}</dd>
            <dt className="opacity-70">{t.barber}</dt>
            <dd className="font-medium">{barberName}</dd>
            <dt className="opacity-70">{t.when}</dt>
            <dd className="font-medium first-letter:uppercase">
              {formatDateTime(params.data.inizio, shop.timezone)}
            </dd>
            <dt className="opacity-70">{t.price}</dt>
            <dd className="font-medium">
              {formatCents(service.priceCents)} ·{" "}
              {it.booking.duration.replace("{count}", String(service.durationMin))}
            </dd>
          </dl>
          {access !== "ok" ? (
            <AccessNotice
              access={access}
              phone={shop.phone}
              retryHref={summaryStepUrl(service.id, barberId, params.data.inizio)}
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
