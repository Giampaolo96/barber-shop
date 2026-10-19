import { Bone, LoadingStatus } from "@/components/skeleton";
import { it } from "@/i18n/it";

/** Prenotazioni future mostrate durante il caricamento. */
const ITEMS = 2;

// Scheletro di "Le mie prenotazioni": titolo e intestazioni vere, schede con le misure di page.tsx.
export default function MyBookingsLoading() {
  const t = it.booking.list;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <h1 className="font-display text-4xl leading-tight text-glow">{t.title}</h1>
      <LoadingStatus />
      <section aria-hidden="true" className="flex flex-col gap-2">
        <h2 className="border-b-[3px] border-double border-ink pb-2 font-display text-2xl">{t.upcoming}</h2>
        <ul className="flex flex-col gap-2">
          {Array.from({ length: ITEMS }, (_, i) => (
            <li key={i} className="flex flex-col gap-2 border border-line p-4">
              {/* Data e ora in text-2xl leading-tight: una riga anche su mobile. */}
              <Bone className="h-7.5 w-full" />
              <div className="flex h-6 items-center">
                <Bone className="h-4 w-2/3" />
              </div>
              <div className="flex h-5 items-center">
                <Bone className="h-3.5 w-1/3" />
              </div>
              <Bone className="h-11 w-40" />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
