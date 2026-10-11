import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AccessNotice } from "@/components/booking/access-notice";
import { RestartNotice } from "@/components/booking/restart-notice";
import { StepHeader } from "@/components/booking/step-header";
import { it } from "@/i18n/it";
import { firstBioLine } from "@/lib/booking/format";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { ANY_BARBER, BOOK_PATH, barberStepUrl, timeStepUrl } from "@/lib/booking/paths";
import { getBarbersForService, getBookableService } from "@/lib/booking/queries";
import { EmptyMark } from "@/themes/active";

// Passo 2 di 4 (SPEC §5.2): barbiere oppure "Nessuna preferenza", con i ritratti (fetta 8b).
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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <StepHeader
        step={2}
        title={t.title}
        subtitle={
          service
            ? `${service.name}, ${it.booking.duration.replace("{count}", String(service.durationMin))}`
            : undefined
        }
        backHref={BOOK_PATH}
      />
      {access !== "ok" ? (
        <AccessNotice
          access={access}
          phone={shop.phone}
          retryHref={serviceId.success ? barberStepUrl(serviceId.data) : BOOK_PATH}
        />
      ) : !service || barbers.length === 0 ? (
        <RestartNotice />
      ) : (
        <div className="flex flex-col gap-6">
          <Link
            href={timeStepUrl(service.id, ANY_BARBER)}
            className="on-ink flex min-h-16 items-center gap-4 border border-ink bg-ink p-4 text-surface transition-colors hover:bg-surface hover:text-ink active:bg-surface active:text-ink"
          >
            <EmptyMark className="size-8 shrink-0" />
            <span className="flex flex-col">
              <span className="font-display text-2xl leading-tight">{t.any}</span>
              <span className="text-sm">{t.anyHint}</span>
            </span>
          </Link>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-6">
            {barbers.map((barber) => {
              const specialty = firstBioLine(barber.bio);
              return (
                <li key={barber.id}>
                  <Link
                    href={timeStepUrl(service.id, barber.id)}
                    className="group flex flex-col gap-2 [&:active_img]:opacity-80"
                  >
                    {barber.photoUrl ? (
                      // Foto da URL https esterno (decisione fetta 3): niente ottimizzazione di Next.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={barber.photoUrl}
                        alt=""
                        width={320}
                        height={320}
                        className="aspect-square w-full border border-ink object-cover grayscale transition-[border-width] group-hover:border-4 group-active:border-4"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="flex aspect-square w-full items-center justify-center border border-dashed border-ink font-display text-6xl transition-colors group-hover:bg-ink group-hover:text-surface group-active:bg-ink group-active:text-surface"
                      >
                        {barber.name.charAt(0)}
                      </span>
                    )}
                    <span className="flex flex-col">
                      <span className="font-display text-xl leading-tight underline-offset-4 group-hover:underline">
                        {barber.name}
                      </span>
                      {specialty && <span className="text-sm text-muted-foreground">{specialty}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </main>
  );
}
