import { z } from "zod";
import { BlockedNotice } from "@/components/booking/blocked-notice";
import { RestartNotice } from "@/components/booking/restart-notice";
import { SlotPicker } from "@/components/booking/slot-picker";
import { StepHeader } from "@/components/booking/step-header";
import { it } from "@/i18n/it";
import { getAvailableDays, getAvailableSlots } from "@/lib/booking/availability";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { ANY_BARBER, BOOK_PATH, barberStepUrl } from "@/lib/booking/paths";
import { getBookableService } from "@/lib/booking/queries";
import { barberChoiceSchema } from "@/lib/booking/schemas";
import { addDays, isValidLocalDate, localDateOf } from "@/lib/domain/local-time";

const paramsSchema = z.object({
  servizio: z.uuid(),
  barbiere: barberChoiceSchema,
  giorno: z.string().refine(isValidLocalDate).optional().catch(undefined),
});

// Passo 3 di 4 (SPEC §5.2): giorno (striscia orizzontale) e orario (griglia). Giorno e orari sono
// resi dal server a partire dall'URL; dopo l'idratazione il cambio di giorno non ricarica la pagina.
export default async function ChooseTimePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { shop, blocked } = await loadBookingPageContext();
  const params = paramsSchema.safeParse(await searchParams);
  const service = params.success && !blocked ? await getBookableService(params.data.servizio) : null;
  const barberId = params.success ? params.data.barbiere : ANY_BARBER;
  const validBarber = service !== null && (barberId === ANY_BARBER || service.barberIds.includes(barberId));
  const backHref =
    service && service.barberIds.length > 1 ? barberStepUrl(service.id) : BOOK_PATH;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <StepHeader step={3} title={it.booking.time.title} backHref={backHref} />
      {blocked ? (
        <BlockedNotice phone={shop.phone} />
      ) : !service || !validBarber ? (
        <RestartNotice />
      ) : (
        <Picker
          serviceId={service.id}
          barberId={barberId}
          requestedDay={params.success ? params.data.giorno : undefined}
          timezone={shop.timezone}
          horizonDays={shop.maxHorizonDays}
        />
      )}
    </main>
  );
}

async function Picker({
  serviceId,
  barberId,
  requestedDay,
  timezone,
  horizonDays,
}: {
  serviceId: string;
  barberId: string;
  requestedDay: string | undefined;
  timezone: string;
  horizonDays: number;
}) {
  const today = localDateOf(new Date(), timezone);
  const daysResult = await getAvailableDays({
    serviceId,
    barberId,
    from: today,
    to: addDays(today, horizonDays),
  });
  if (!daysResult.ok) {
    return <p role="alert">{it.booking.errors.generic}</p>;
  }
  const days = daysResult.days;
  if (days.length === 0) return <p className="opacity-70">{it.booking.time.noDays}</p>;

  const selectedDay = requestedDay && days.includes(requestedDay) ? requestedDay : days[0];
  const slotsResult = await getAvailableSlots({ serviceId, barberId, date: selectedDay });

  return (
    <SlotPicker
      serviceId={serviceId}
      barberId={barberId}
      timezone={timezone}
      days={days}
      initialDay={selectedDay}
      initialSlots={slotsResult.ok ? slotsResult.slots : null}
    />
  );
}
