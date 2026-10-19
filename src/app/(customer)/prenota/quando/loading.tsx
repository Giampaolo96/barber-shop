import { StepHeader } from "@/components/booking/step-header";
import { Bone, LoadingStatus } from "@/components/skeleton";
import { it } from "@/i18n/it";
import { BOOK_PATH } from "@/lib/booking/paths";

/** Giorni, colonne e orari mostrati durante il caricamento. */
const DAYS = 10;
const COLUMNS = 3;
const SLOTS = 6;

// Scheletro di "Quando?": stesso contenitore di page.tsx e stesse misure di WhenPicker (striscia dei
// giorni, "Primo libero" alto h-12, colonne con ritratto, nome e orari h-11).
export default function ChooseWhenLoading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 pt-3 pb-4 tall:min-h-0">
      <StepHeader step={2} title={it.booking.when.title} backHref={BOOK_PATH} compact />
      <LoadingStatus />
      <div aria-hidden="true" className="flex flex-col gap-3 tall:min-h-0 tall:flex-1">
        <div className="sticky-bar sticky top-0 z-10 -mx-4 border-b border-line px-3 pt-1">
          {/* overflow-x-auto come la striscia vera: dove la barra di scorrimento occupa spazio, lo occupa anche qui. */}
          <div className="flex gap-2 overflow-x-auto p-1 pb-2">
            {Array.from({ length: DAYS }, (_, i) => (
              <div key={i} className="h-12 w-14 shrink-0 border border-line" />
            ))}
          </div>
        </div>
        <Bone className="h-12 shrink-0" />
        <div className="grid min-w-0 auto-cols-fr grid-flow-col gap-1.5 tall:min-h-0 tall:flex-1 tall:grid-rows-1">
          {Array.from({ length: COLUMNS }, (_, column) => (
            <div key={column} className="flex min-w-0 flex-col">
              <div className="flex flex-col items-center gap-1.5 border-b border-line pb-1.5">
                <Bone className="size-8 shrink-0" />
                <Bone className="h-[1.09375rem] w-3/4" />
              </div>
              <div className="flex flex-col gap-1.5 py-2">
                {Array.from({ length: SLOTS }, (_, slot) => (
                  <Bone key={slot} className="h-11 shrink-0" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
