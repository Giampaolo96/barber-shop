import { StepHeader } from "@/components/booking/step-header";
import { Bone, LoadingStatus } from "@/components/skeleton";
import { it } from "@/i18n/it";

// Scheletro del riepilogo: stesso pannello di page.tsx (etichette vere, valori segnaposto) e lo
// spazio del modulo di conferma (etichetta, nota di 3 righe, pulsante h-14). "Indietro" dipende
// dall'URL: qui resta solo il suo spazio (StepHeader senza backHref).
export default function BookingSummaryLoading() {
  const t = it.booking.summary;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <StepHeader step={3} title={t.title} />
      <LoadingStatus />
      <div aria-hidden="true" className="contents">
        <dl className="glass grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 border border-(--glass-border) p-5">
          <dt className="text-muted-foreground">{t.service}</dt>
          <dd className="flex h-6 items-center">
            <Bone className="h-4 w-32" />
          </dd>
          <dt className="text-muted-foreground">{t.barber}</dt>
          <dd className="flex h-6 items-center">
            <Bone className="h-4 w-24" />
          </dd>
          <dt className="text-muted-foreground">{t.when}</dt>
          {/* Data e ora in text-2xl: su mobile vanno a capo (due righe), da sm stanno in una. */}
          <dd>
            <Bone className="h-15 w-full sm:h-7.5" />
          </dd>
          <dt className="text-muted-foreground">{t.price}</dt>
          <dd className="flex h-6 items-center">
            <Bone className="h-4 w-28" />
          </dd>
        </dl>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Bone className="h-3.5 w-40" />
            <div className="h-22.5 rounded-md border border-line" />
          </div>
          <Bone className="h-14" />
        </div>
      </div>
    </main>
  );
}
