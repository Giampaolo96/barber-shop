import { z } from "zod";
import { BlockedNotice } from "@/components/booking/blocked-notice";
import { RestartNotice } from "@/components/booking/restart-notice";
import { StepHeader } from "@/components/booking/step-header";
import { WhenPicker } from "@/components/booking/when-picker";
import { it } from "@/i18n/it";
import { getWhenOverview, type WhenOverview } from "@/lib/booking/availability";
import { formatDuration } from "@/lib/booking/format";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { BOOK_PATH } from "@/lib/booking/paths";
import { type BookableBarber, getBarbersForService, getBookableService } from "@/lib/booking/queries";
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
  const params = paramsSchema.safeParse(await searchParams);
  const query = params.success ? params.data : null;
  // Le letture dipendono solo dall'URL: partono insieme ai controlli di accesso, la pagina mostra
  // qualcosa solo dopo requireRole (in loadBookingPageContext). Un preferito che non fa il servizio
  // non ha orari, quindi non conta nel "Primo libero" e più sotto viene scartato.
  const [{ shop, access }, bookable, allBarbers, overview] = await Promise.all([
    loadBookingPageContext(),
    query ? getBookableService(query.servizio) : null,
    query ? getBarbersForService(query.servizio) : [],
    query
      ? getWhenOverview({ serviceId: query.servizio, requestedDay: query.giorno, barberId: query.barbiere })
      : null,
  ]);
  // Al cliente bloccato non si mostra nulla del servizio, come prima della lettura in parallelo.
  const service = access === "ok" ? bookable : null;

  return (
    // Più larga della colonna di lettura: una colonna di orari per barbiere (sugli schermi alti
    // occupa lo schermo e scorrono solo le colonne, vedi globals.css).
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 pt-3 pb-4 tall:min-h-0">
      <StepHeader
        step={2}
        title={it.booking.when.title}
        subtitle={service ? `${service.name}, ${formatDuration(service.durationMin)}` : undefined}
        backHref={BOOK_PATH}
        compact
      />
      {access !== "ok" ? (
        <BlockedNotice phone={shop.phone} />
      ) : !service || !query || !overview ? (
        <RestartNotice />
      ) : (
        <When
          serviceId={service.id}
          requestedBarberId={query.barbiere}
          allBarbers={allBarbers}
          overview={overview}
          timezone={shop.timezone}
        />
      )}
    </main>
  );
}

function When({
  serviceId,
  requestedBarberId,
  allBarbers,
  overview,
  timezone,
}: {
  serviceId: string;
  requestedBarberId: string | undefined;
  allBarbers: BookableBarber[];
  overview: WhenOverview;
  timezone: string;
}) {
  const preferredId = allBarbers.some((b) => b.id === requestedBarberId) ? requestedBarberId : undefined;
  if (!overview.ok) return <p role="alert">{it.booking.errors.generic}</p>;
  if (allBarbers.length === 0) return <RestartNotice />;
  if (!overview.day) return <p className="text-muted-foreground">{it.booking.time.noDays}</p>;

  const barbers = orderBarbers(allBarbers, { preferredId, recentId: overview.recentId }).map((b) => ({
    id: b.id,
    name: b.name,
    photoUrl: b.photoUrl,
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
