import Link from "next/link";
import { AccessNotice } from "@/components/booking/access-notice";
import { StepHeader, choiceClass } from "@/components/booking/step-header";
import { it } from "@/i18n/it";
import { formatCents } from "@/lib/domain/money";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { BOOK_PATH, barberStepUrl, timeStepUrl } from "@/lib/booking/paths";
import { getBookableServices } from "@/lib/booking/queries";

// Passo 1 di 4 (SPEC §5.2): scelta del servizio.
export default async function ChooseServicePage() {
  const { shop, access } = await loadBookingPageContext();
  const t = it.booking;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <StepHeader step={1} title={t.service.title} backHref="/" />
      {access !== "ok" ? (
        <AccessNotice access={access} phone={shop.phone} retryHref={BOOK_PATH} />
      ) : (
        <ServiceList />
      )}
    </main>
  );
}

async function ServiceList() {
  const services = await getBookableServices();
  if (services.length === 0) return <p className="opacity-70">{it.booking.service.empty}</p>;

  return (
    <ul className="flex flex-col gap-2">
      {services.map((service) => {
        // Con un solo barbiere abilitato il passo del barbiere si salta.
        const href =
          service.barberIds.length === 1
            ? timeStepUrl(service.id, service.barberIds[0])
            : barberStepUrl(service.id);
        return (
          <li key={service.id}>
            <Link href={href} className={choiceClass}>
              <span className="flex flex-1 flex-col">
                <span className="font-medium">{service.name}</span>
                {service.description && (
                  <span className="text-sm opacity-70">{service.description}</span>
                )}
              </span>
              <span className="flex flex-col items-end text-sm">
                <span className="font-medium">{formatCents(service.priceCents)}</span>
                <span className="opacity-70">
                  {it.booking.duration.replace("{count}", String(service.durationMin))}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
