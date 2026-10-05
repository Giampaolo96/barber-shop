"use client";

import Link, { useLinkStatus } from "next/link";
import { useState, useTransition } from "react";
import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { fetchAvailableSlots } from "@/lib/booking/availability-actions";
import { dayParts, formatDayLabel, formatTime } from "@/lib/booking/format";
import { summaryStepUrl, timeStepUrl } from "@/lib/booking/paths";
import { addDays } from "@/lib/domain/local-time";
import { PendingMark } from "@/themes/active";

/**
 * Caselle dei giorni e orari del giorno scelto (SPEC §5.2). I giorni sono link (funzionano anche
 * prima dell'idratazione); dopo, il cambio di giorno chiede solo gli orari. Fra il primo e
 * l'ultimo giorno disponibile quelli senza orari restano visibili, tratteggiati e non cliccabili.
 * Gli orari sono raggruppati per ora: l'ora grande a sinistra, i minuti a destra; un salto di ore
 * (es. la pausa pranzo) diventa un divisore. Un tocco sull'orario apre il riepilogo.
 * `initialSlots` null = caricamento non riuscito.
 */
export function SlotPicker({
  serviceId,
  barberId,
  timezone,
  days,
  initialDay,
  initialSlots,
}: {
  serviceId: string;
  barberId: string;
  timezone: string;
  days: string[];
  initialDay: string;
  initialSlots: string[] | null;
}) {
  const t = it.booking.time;
  const [day, setDay] = useState(initialDay);
  const [slots, setSlots] = useState(initialSlots);
  const [pending, startTransition] = useTransition();

  const dayUrl = (date: string) => `${timeStepUrl(serviceId, barberId)}&giorno=${date}`;
  const available = new Set(days);

  const selectDay = (date: string) => {
    setDay(date);
    window.history.replaceState(null, "", dayUrl(date));
    startTransition(async () => {
      const result = await fetchAvailableSlots({ serviceId, barberId, date });
      setSlots(result.ok ? result.slots : null);
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t.daysLabel} className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2 pb-2">
          {dateRange(days).map((date, index) => {
            const parts = dayParts(date);
            const showMonth = index === 0 || parts.day === "1";
            const content = (
              <>
                <span className="text-xs">{parts.weekday}</span>
                <span className="font-display text-2xl leading-none tabular-nums">{parts.day}</span>
                <span className={`text-xs ${showMonth ? "" : "invisible"}`}>{parts.month}</span>
              </>
            );
            const box = "flex h-20 w-14 flex-col items-center justify-center gap-1 border";
            return (
              <li key={date}>
                {available.has(date) ? (
                  <Link
                    href={dayUrl(date)}
                    aria-label={formatDayLabel(date)}
                    aria-current={date === day ? "date" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      selectDay(date);
                    }}
                    className={`${box} border-ink hover:bg-disabled aria-[current=date]:bg-ink aria-[current=date]:text-surface`}
                  >
                    {content}
                  </Link>
                ) : (
                  <span className={`${box} border-dashed border-line text-ink-disabled`}>
                    <span aria-hidden="true" className="contents">
                      {content}
                    </span>
                    <span className="sr-only">{fillText(t.dayUnavailable, { day: formatDayLabel(date) })}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-label={t.slotsLabel} aria-busy={pending} className="flex flex-col">
        {pending ? (
          <p className="text-muted-foreground">{t.loading}</p>
        ) : slots === null ? (
          <p role="alert">{it.booking.errors.generic}</p>
        ) : slots.length === 0 ? (
          <p className="text-muted-foreground">{t.noSlots}</p>
        ) : (
          groupByHour(slots, timezone).map((group, index, groups) => {
            // Un salto di ore rispetto al gruppo precedente (pausa pranzo, ore occupate).
            const gap = index > 0 && Number(group.hour) - Number(groups[index - 1].hour) > 1;
            return (
              <div
                key={`${group.hour}-${index}`}
                className={`flex items-start gap-4 border-t py-3 ${gap ? "mt-4 border-t-ink" : "border-line"}`}
              >
                <span
                  aria-hidden="true"
                  className="w-12 shrink-0 font-display text-4xl leading-none tabular-nums"
                >
                  {Number(group.hour)}
                </span>
                <ul className="grid flex-1 grid-cols-4 gap-2">
                  {group.slots.map((slot) => (
                    <li key={slot.iso}>
                      <Link
                        href={summaryStepUrl(serviceId, barberId, slot.iso)}
                        aria-label={`${group.hour}${slot.minutes}`}
                        className="relative flex h-11 items-center justify-center border border-ink text-sm font-medium tabular-nums hover:bg-ink hover:text-surface"
                      >
                        {/* Nome accessibile (aria-label) e testo restano l'ora completa HH:MM; l'ora non si
                            vede perché è già a sinistra (font a 0: resta nel testo, senza spazi). */}
                        <span>
                          <span className="text-[0px]">{group.hour}</span>
                          {slot.minutes}
                        </span>
                        <SlotPending />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

/** Mentre si apre il riepilogo lo slot toccato diventa pieno, con il segno del tema. */
function SlotPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 flex items-center justify-center bg-ink text-surface"
    >
      <PendingMark className="size-6" />
    </span>
  );
}

/** Tutti i giorni dal primo all'ultimo disponibile. */
function dateRange(days: string[]): string[] {
  if (days.length === 0) return [];
  const last = days[days.length - 1];
  const out: string[] = [];
  for (let date = days[0]; date <= last; date = addDays(date, 1)) out.push(date);
  return out;
}

/** Orari raggruppati per ora locale: "09" → [":00", ":15", …], con l'istante di ciascuno. */
function groupByHour(slots: string[], timezone: string) {
  const groups: Array<{ hour: string; slots: Array<{ iso: string; minutes: string }> }> = [];
  for (const iso of slots) {
    const [hour, minutes] = formatTime(iso, timezone).split(":");
    const last = groups.at(-1);
    const entry = { iso, minutes: `:${minutes}` };
    if (last?.hour === hour) last.slots.push(entry);
    else groups.push({ hour, slots: [entry] });
  }
  return groups;
}
