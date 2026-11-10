import Link from "next/link";
import { LinkPending } from "@/components/link-pending";
import { BlockedNotice } from "@/components/booking/blocked-notice";
import { StepHeader } from "@/components/booking/step-header";
import { it } from "@/i18n/it";
import { formatDuration } from "@/lib/booking/format";
import { formatCents } from "@/lib/domain/money";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { whenStepUrl } from "@/lib/booking/paths";
import { type BookableService, getBookableServices } from "@/lib/booking/queries";
import { EmptyMark } from "@/themes/active";

// Passo 1 di 3 (SPEC §5.2): scelta del servizio, impaginata come un listino (fetta 8b).
export default async function ChooseServicePage() {
  // Il listino non dipende dall'utente: si legge insieme ai controlli e si mostra solo dopo requireRole.
  const [{ shop, access }, services] = await Promise.all([loadBookingPageContext(), getBookableServices()]);
  const t = it.booking;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <StepHeader
        step={1}
        title={t.service.title}
        subtitle={t.service.subtitle}
        mark={<EmptyMark className="size-8 shrink-0" />}
        backHref="/"
      />
      {access !== "ok" ? (
        <BlockedNotice phone={shop.phone} />
      ) : (
        <ServiceList services={services} />
      )}
    </main>
  );
}

function ServiceList({ services }: { services: BookableService[] }) {
  if (services.length === 0) return <p className="text-muted-foreground">{it.booking.service.empty}</p>;

  return (
    <ul className="border-y-[3px] border-double border-ink">
      {services.map((service) => {
        // Fetta 8e: dal servizio si passa sempre a "Quando?", con gli orari di tutti i barbieri.
        const href = whenStepUrl(service.id);
        const duration = formatDuration(service.durationMin);
        const price = formatCents(service.priceCents);
        return (
          <li key={service.id} className="border-b border-line last:border-b-0">
            <Link
              href={href}
              aria-label={`${service.name}, ${duration}, ${price}`}
              className="glow-hover relative flex min-h-16 flex-col justify-center gap-1 py-3 hover:bg-ink hover:text-surface active:bg-ink active:text-surface [&:active_.text-muted-foreground]:text-surface [&:hover_.text-muted-foreground]:text-surface"
            >
              {/* Righe a filo del titolo e dei doppi filetti, senza rientro (fetta 8k). */}
              <span className="flex items-baseline gap-2 font-display text-2xl leading-tight">
                <span>{service.name}</span>
                <span aria-hidden="true" className="mb-1.5 flex-1 border-b-2 border-dotted border-current" />
                <span className="tabular-nums">{price}</span>
              </span>
              {/* Durata e descrizione su una sola riga grigia (fetta 8k). */}
              <span className="text-sm text-muted-foreground">
                <span className="tabular-nums">{duration}</span>
                {service.description && <span className="ml-3">{service.description}</span>}
              </span>
              <LinkPending />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
