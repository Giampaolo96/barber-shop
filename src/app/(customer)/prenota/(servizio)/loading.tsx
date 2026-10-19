import { StepHeader } from "@/components/booking/step-header";
import { Bone, LoadingStatus } from "@/components/skeleton";
import { it } from "@/i18n/it";
import { EmptyMark } from "@/themes/active";

/** Righe del listino mostrate durante il caricamento. */
const ROWS = 4;

// Scheletro del listino: intestazione vera (non dipende dai dati), righe con le misure di page.tsx.
export default function ChooseServiceLoading() {
  const t = it.booking;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <StepHeader
        step={1}
        title={t.service.title}
        subtitle={t.service.subtitle}
        mark={<EmptyMark className="mb-1 size-8 shrink-0" />}
        backHref="/"
      />
      <LoadingStatus />
      <ul aria-hidden="true" className="border-y-[3px] border-double border-ink">
        {Array.from({ length: ROWS }, (_, i) => (
          <li key={i} className="border-b border-line last:border-b-0">
            {/* Nome e prezzo (text-2xl leading-tight), poi durata e descrizione (due righe text-sm). */}
            <div className="flex min-h-16 flex-col justify-center gap-1 px-2 py-3">
              <Bone className="h-7.5 w-3/4" />
              <div className="flex h-10 flex-col justify-center gap-1.5">
                <Bone className="h-3.5 w-16" />
                <Bone className="h-3.5 w-2/3" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
