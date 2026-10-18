import { z } from "zod";
import { AccessNotice } from "@/components/booking/access-notice";
import { RestartNotice } from "@/components/booking/restart-notice";
import { StepHeader } from "@/components/booking/step-header";
import { WhenPicker } from "@/components/booking/when-picker";
import { it } from "@/i18n/it";
import { getWhenOverview } from "@/lib/booking/availability";
import { firstBioLine, formatDuration } from "@/lib/booking/format";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { BOOK_PATH, whenStepUrl } from "@/lib/booking/paths";
import { getBarbersForService, getBookableService } from "@/lib/booking/queries";
import { orderBarbers } from "@/lib/booking/when";
import { isValidLocalDate } from "@/lib/domain/local-time";

const paramsSchema = z.object({
  servizio: z.uuid(),
  giorno: z.string().refine(isValidLocalDate).optional().catch(undefined),
  barbiere: z.uuid().optional().catch(undefined),
});

// Passo 2 di 3 (SPEC §5.2, fetta 8e): "Quando?", gli orari liberi di tutti i barbieri del servizio
// nel giorno scelto. Striscia dei giorni e primo giorno resi dal server da una sola lettura del
// periodo prenotabile; dopo l'idratazione il cambio di giorno chiede solo quel giorno.
export default async function ChooseWhenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { shop, access } = await loadBookingPageContext();
  const params = paramsSchema.safeParse(await searchParams);
  const service = params.success && access === "ok" ? await getBookableService(params.data.servizio) : null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <StepHeader
        step={2}
        title={it.booking.when.title}
        subtitle={service ? `${service.name}, ${formatDuration(service.durationMin)}` : undefined}
        backHref={BOOK_PATH}
      />
      {access !== "ok" ? (
        <AccessNotice
          access={access}
          phone={shop.phone}
          retryHref={params.success ? whenStepUrl(params.data.servizio) : BOOK_PATH}
        />
      ) : !service || !params.success ? (
        <RestartNotice />
      ) : (
        <When
          serviceId={service.id}
          requestedDay={params.data.giorno}
          requestedBarberId={params.data.barbiere}
          timezone={shop.timezone}
        />
      )}
    </main>
  );
}

async function When({
  serviceId,
  requestedDay,
  requestedBarberId,
  timezone,
}: {
  serviceId: string;
  requestedDay: string | undefined;
  requestedBarberId: string | undefined;
  timezone: string;
}) {
  // Le due letture sono indipendenti: un preferito che non fa il servizio non ha orari, quindi
  // non conta nel "Primo libero" e qui sotto viene scartato anche per l'ordine e l'evidenza.
  const [allBarbers, overview] = await Promise.all([
    getBarbersForService(serviceId),
    getWhenOverview({ serviceId, requestedDay, barberId: requestedBarberId }),
  ]);
  const preferredId = allBarbers.some((b) => b.id === requestedBarberId) ? requestedBarberId : undefined;
  if (!overview.ok) return <p role="alert">{it.booking.errors.generic}</p>;
  if (allBarbers.length === 0) return <RestartNotice />;
  if (!overview.day) return <p className="text-muted-foreground">{it.booking.time.noDays}</p>;

  const barbers = orderBarbers(allBarbers, { preferredId, recentId: overview.recentId }).map((b) => ({
    id: b.id,
    name: b.name,
    photoUrl: b.photoUrl,
    bioLine: firstBioLine(b.bio),
  }));

  return (
    <WhenPicker
      serviceId={serviceId}
      timezone={timezone}
      preferredId={preferredId ?? null}
      recentId={overview.recentId}
      barbers={barbers}
      days={overview.days}
      initialDay={overview.day}
    />
  );
}
