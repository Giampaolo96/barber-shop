import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AccessNotice } from "@/components/booking/access-notice";
import { RestartNotice } from "@/components/booking/restart-notice";
import { StepHeader, choiceClass } from "@/components/booking/step-header";
import { it } from "@/i18n/it";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { ANY_BARBER, BOOK_PATH, barberStepUrl, timeStepUrl } from "@/lib/booking/paths";
import { getBarbersForService, getBookableService } from "@/lib/booking/queries";

// Passo 2 di 4 (SPEC §5.2): barbiere oppure "Nessuna preferenza".
export default async function ChooseBarberPage({
  searchParams,
}: {
  searchParams: Promise<{ servizio?: string }>;
}) {
  const { shop, access } = await loadBookingPageContext();
  const t = it.booking.barber;
  const serviceId = z.uuid().safeParse((await searchParams).servizio);

  const service = serviceId.success && access === "ok" ? await getBookableService(serviceId.data) : null;
  const barbers = service ? await getBarbersForService(service.id) : [];
  if (service && barbers.length === 1) redirect(timeStepUrl(service.id, barbers[0].id));

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <StepHeader step={2} title={t.title} backHref={BOOK_PATH} />
      {access !== "ok" ? (
        <AccessNotice
          access={access}
          phone={shop.phone}
          retryHref={serviceId.success ? barberStepUrl(serviceId.data) : BOOK_PATH}
        />
      ) : !service || barbers.length === 0 ? (
        <RestartNotice />
      ) : (
        <ul className="flex flex-col gap-2">
          <li>
            <Link href={timeStepUrl(service.id, ANY_BARBER)} className={choiceClass}>
              <span className="flex flex-col">
                <span className="font-medium">{t.any}</span>
                <span className="text-sm opacity-70">{t.anyHint}</span>
              </span>
            </Link>
          </li>
          {barbers.map((barber) => (
            <li key={barber.id}>
              <Link href={timeStepUrl(service.id, barber.id)} className={choiceClass}>
                {barber.photoUrl ? (
                  // Foto da URL https esterno (decisione fetta 3): niente ottimizzazione di Next.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={barber.photoUrl}
                    alt=""
                    width={48}
                    height={48}
                    className="size-12 rounded-full object-cover"
                  />
                ) : (
                  <span aria-hidden className="size-12 rounded-full bg-muted" />
                )}
                <span className="flex flex-col">
                  <span className="font-medium">{barber.name}</span>
                  {barber.bio && <span className="text-sm opacity-70">{barber.bio}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
