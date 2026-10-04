"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { it } from "@/i18n/it";
import { fetchAvailableSlots } from "@/lib/booking/availability-actions";
import { formatDayLabel, formatTime } from "@/lib/booking/format";
import { summaryStepUrl, timeStepUrl } from "@/lib/booking/paths";

/**
 * Striscia dei giorni con orari liberi e griglia degli orari del giorno scelto. I giorni sono link
 * (funzionano anche prima dell'idratazione); dopo, il cambio di giorno chiede solo gli orari.
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

  const selectDay = (date: string) => {
    setDay(date);
    window.history.replaceState(null, "", dayUrl(date));
    startTransition(async () => {
      const result = await fetchAvailableSlots({ serviceId, barberId, date });
      setSlots(result.ok ? result.slots : null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t.daysLabel} className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2 pb-1">
          {days.map((date) => (
            <li key={date}>
              <Link
                href={dayUrl(date)}
                aria-current={date === day ? "date" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  selectDay(date);
                }}
                className="flex h-14 min-w-16 flex-col items-center justify-center rounded-xl border px-3 text-sm whitespace-nowrap aria-[current=date]:border-primary aria-[current=date]:bg-primary aria-[current=date]:text-primary-foreground"
              >
                {formatDayLabel(date)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-label={t.slotsLabel} aria-busy={pending} className="flex flex-col gap-2">
        {pending ? (
          <p className="opacity-70">{t.loading}</p>
        ) : slots === null ? (
          <p role="alert">{it.booking.errors.generic}</p>
        ) : slots.length === 0 ? (
          <p className="opacity-70">{t.noSlots}</p>
        ) : (
          <ul className="grid grid-cols-4 gap-2">
            {slots.map((slot) => (
              <li key={slot}>
                <Link
                  href={summaryStepUrl(serviceId, barberId, slot)}
                  className="flex h-11 items-center justify-center rounded-lg border text-sm font-medium active:bg-muted"
                >
                  {formatTime(slot, timezone)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
