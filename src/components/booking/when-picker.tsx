"use client";

import Link, { useLinkStatus } from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { BarberPortrait } from "@/components/barber-portrait";
import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import type { DayStatus } from "@/lib/availability";
import type { WhenBarberDay, WhenDay } from "@/lib/booking/availability";
import { fetchWhenDay } from "@/lib/booking/availability-actions";
import { dayParts, formatDayLabel } from "@/lib/booking/format";
import { summaryStepUrl, whenStepUrl } from "@/lib/booking/paths";
import { firstFreeAmong, formatNextFree, formatSlotTime, splitByPeriod } from "@/lib/booking/when";
import { isWhenLoading, whenReducer } from "@/lib/booking/when-state";
import { localDateOf } from "@/lib/domain/local-time";
import { PendingMark } from "@/themes/active";

export type WhenBarber = { id: string; name: string; photoUrl: string | null; bioLine: string | null };

/** id dell'intestazione della sezione di un barbiere (anche destinazione del focus). */
const headingIdOf = (barberId: string): string => `barber-${barberId}`;

/**
 * "Quando?" (SPEC §5.2, fetta 8e): striscia dei giorni fissa in alto, "Primo libero" e una sezione
 * per barbiere con gli orari del giorno scelto. I giorni e gli orari sono link (funzionano anche
 * prima dell'idratazione); dopo, il cambio di giorno chiede solo quel giorno, tiene in memoria i
 * giorni già visti e prepara il successivo. Durante il caricamento le sezioni restano al loro posto;
 * una risposta arrivata in ritardo per un giorno non più selezionato si ignora (whenReducer).
 */
export function WhenPicker({
  serviceId,
  timezone,
  preferredId,
  recentId,
  barbers,
  days,
  initialDay,
}: {
  serviceId: string;
  timezone: string;
  /** Barbiere arrivato dall'URL: sezione evidenziata e precedenza nel "Primo libero". */
  preferredId: string | null;
  /** Barbiere dell'ultimo appuntamento: precedenza nel "Primo libero" dopo il preferito. */
  recentId: string | null;
  /** Già nell'ordine delle sezioni. */
  barbers: WhenBarber[];
  days: DayStatus[];
  initialDay: WhenDay;
}) {
  const t = it.booking.when;
  const [view, dispatch] = useReducer(whenReducer, { selected: initialDay.date, shown: initialDay, error: false });
  const { selected, shown, error } = view;
  /** Testo della regione aria-live: il giorno scelto (vuoto all'apertura). */
  const [announcement, setAnnouncement] = useState("");
  /** Sezione su cui portare il focus quando arriva il giorno (dopo "prossimo: …"). */
  const focusAfterLoad = useRef<string | null>(null);
  const cache = useRef(new Map<string, WhenDay>([[initialDay.date, initialDay]]));
  const requests = useRef(new Map<string, Promise<WhenDay | null>>());

  const dayUrl = useCallback(
    (date: string) => whenStepUrl(serviceId, { day: date, barberId: preferredId ?? undefined }),
    [serviceId, preferredId],
  );

  /** Un giorno dalla memoria o dal server; la stessa richiesta in corso si riusa. */
  const load = useCallback(
    (date: string): Promise<WhenDay | null> => {
      const cached = cache.current.get(date);
      if (cached) return Promise.resolve(cached);
      let request = requests.current.get(date);
      if (!request) {
        request = fetchWhenDay({
          serviceId,
          date,
          barberId: preferredId ?? undefined,
          recentBarberId: recentId ?? undefined,
        })
          .then((result) => {
            if (!result.ok) return null;
            const day: WhenDay = { date: result.date, firstFree: result.firstFree, barbers: result.barbers };
            cache.current.set(date, day);
            return day;
          })
          .catch(() => null)
          .finally(() => requests.current.delete(date));
        requests.current.set(date, request);
      }
      return request;
    },
    [serviceId, preferredId, recentId],
  );

  // Il giorno mostrato finisce sempre nell'URL (anche all'apertura senza `giorno`), senza nuove voci
  // nella cronologia. Poi si prepara il giorno selezionabile successivo.
  useEffect(() => {
    window.history.replaceState(null, "", dayUrl(shown.date));
    const next = days.find((d) => d.date > shown.date && d.status !== "closed");
    if (next) void load(next.date);
  }, [shown.date, days, dayUrl, load]);

  // Dopo "prossimo: …" il focus va sull'intestazione del barbiere, appena il giorno è arrivato.
  useEffect(() => {
    const barberId = focusAfterLoad.current;
    if (!barberId || selected !== shown.date) return;
    focusAfterLoad.current = null;
    document.getElementById(headingIdOf(barberId))?.focus();
  }, [selected, shown.date]);

  const selectDay = (date: string, focusBarberId?: string) => {
    focusAfterLoad.current = focusBarberId ?? null;
    setAnnouncement(fillText(t.dayAnnounce, { day: formatDayLabel(date) }));
    const cached = cache.current.get(date);
    dispatch({ type: "select", date, cached });
    if (cached) return;
    void load(date).then((day) => dispatch({ type: "loaded", date, day }));
  };

  const loading = isWhenLoading(view);
  const byId = new Map(shown.barbers.map((b) => [b.barberId, b]));
  const first = firstFreeAmong(
    shown,
    barbers.map((b) => b.id),
  );
  const firstBarber = first ? barbers.find((b) => b.id === first.barberId) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <DayStrip days={days} selected={selected} dayUrl={dayUrl} onSelect={(date) => selectDay(date)} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {error ? (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
          {it.booking.errors.generic}
        </p>
      ) : (
        <div aria-busy={loading} className="flex flex-col gap-6">
          {/* Altezza fissa: con o senza "Primo libero" (e durante il caricamento) le sezioni non si spostano. */}
          <div className="h-14">
            {loading ? (
              <div aria-hidden="true" className="h-14 bg-disabled" />
            ) : first && firstBarber ? (
              <Link
                href={summaryStepUrl(serviceId, firstBarber.id, first.startsAt, preferredId ?? undefined)}
                className="on-ink relative flex h-14 items-center border border-ink bg-ink px-4 font-medium text-surface transition-colors hover:bg-surface hover:text-ink active:bg-surface active:text-ink"
              >
                {fillText(t.firstFree, {
                  time: formatSlotTime(first.startsAt, timezone),
                  barber: firstBarber.name,
                })}
                <SlotPending />
              </Link>
            ) : (
              <p className="flex h-14 items-center text-muted-foreground">{t.noSlots}</p>
            )}
          </div>

          <div aria-label={t.barbersLabel} role="group" className="flex flex-col">
            {barbers.map((barber) => (
              <BarberDay
                key={barber.id}
                serviceId={serviceId}
                timezone={timezone}
                barber={barber}
                day={byId.get(barber.id)}
                preferred={barber.id === preferredId}
                preferredId={preferredId}
                loading={loading}
                dayUrl={dayUrl}
                onSelectDay={(date) => selectDay(date, barber.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Striscia dei giorni (fissa in alto). Navigazione da tastiera a "roving tabindex": Tab entra sul
 * giorno selezionato, ←/→ (e Inizio/Fine) spostano il focus, Invio seleziona.
 */
function DayStrip({
  days,
  selected,
  dayUrl,
  onSelect,
}: {
  days: DayStatus[];
  selected: string;
  dayUrl: (date: string) => string;
  onSelect: (date: string) => void;
}) {
  const t = it.booking;
  const listRef = useRef<HTMLUListElement>(null);

  // Il giorno selezionato resta visibile nella striscia (solo scorrimento orizzontale interno).
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="date"]');
    if (!list || !current) return;
    const left = current.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + current.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = left - (list.clientWidth - current.offsetWidth) / 2;
    }
  }, [selected]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const links = [...(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-day]") ?? [])];
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (index < 0) return;
    const target =
      event.key === "ArrowRight"
        ? links[index + 1]
        : event.key === "ArrowLeft"
          ? links[index - 1]
          : event.key === "Home"
            ? links[0]
            : event.key === "End"
              ? links.at(-1)
              : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <nav aria-label={t.time.daysLabel} className="sticky top-0 z-10 -mx-4 border-b border-line bg-surface px-3 pt-1">
      {/* p-1: il contorno del focus (2 px staccato di 2 px) non viene tagliato dallo scorrimento. */}
      <ul ref={listRef} onKeyDown={onKeyDown} className="flex gap-2 overflow-x-auto p-1 pb-2">
        {days.map((day, index) => {
          const parts = dayParts(day.date);
          const showMonth = index === 0 || parts.day === "1";
          const content = (
            <span aria-hidden="true" className="contents">
              <span className="text-xs">{parts.weekday}</span>
              <span className="font-display text-2xl leading-none tabular-nums">{parts.day}</span>
              <span className={`text-xs ${showMonth ? "" : "invisible"}`}>{parts.month}</span>
            </span>
          );
          const label = formatDayLabel(day.date);
          // relative: il testo sr-only resta dentro la striscia che scorre (niente scroll della pagina).
          const box = "relative flex h-20 w-14 shrink-0 flex-col items-center justify-center gap-1 border";
          return (
            <li key={day.date}>
              {day.status === "closed" ? (
                <span aria-disabled="true" className={`${box} border-line bg-disabled text-ink-disabled`}>
                  {content}
                  <span className="sr-only">{fillText(t.when.dayClosed, { day: label })}</span>
                </span>
              ) : (
                <a
                  href={dayUrl(day.date)}
                  data-day={day.date}
                  tabIndex={day.date === selected ? 0 : -1}
                  aria-current={day.date === selected ? "date" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelect(day.date);
                  }}
                  // "Senza posti": bordo tratteggiato e testo secondario (contrasto ≥ 4,5:1), non solo il grigio.
                  className={`${box} ${
                    day.status === "open" ? "border-ink" : "border-dashed border-ink text-muted-foreground"
                  } hover:bg-disabled aria-[current=date]:border-solid aria-[current=date]:border-ink aria-[current=date]:bg-ink aria-[current=date]:text-surface`}
                >
                  {content}
                  <span className="sr-only">
                    {day.status === "open" ? label : fillText(t.time.dayUnavailable, { day: label })}
                  </span>
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Sezione di un barbiere: ritratto, nome, prima riga della bio e orari del giorno. */
function BarberDay({
  serviceId,
  timezone,
  barber,
  day,
  preferred,
  preferredId,
  loading,
  dayUrl,
  onSelectDay,
}: {
  serviceId: string;
  timezone: string;
  barber: WhenBarber;
  /** Assente: il barbiere non ha righe nel periodo (nessun orario di lavoro). */
  day: WhenBarberDay | undefined;
  preferred: boolean;
  /** Preferito dall'URL, portato al riepilogo per "Indietro" e "Cambia orario". */
  preferredId: string | null;
  loading: boolean;
  dayUrl: (date: string) => string;
  onSelectDay: (date: string) => void;
}) {
  const t = it.booking.when;
  const headingId = headingIdOf(barber.id);
  // Durante il caricamento `day` è ancora quello del giorno precedente: lo scheletro ne tiene le righe.
  const slots = day?.slots ?? [];
  const placeholderRows = Math.max(1, Math.ceil(slots.length / 4));

  const { morning, afternoon } = splitByPeriod(slots, timezone);
  const both = morning.length > 0 && afternoon.length > 0;
  const groupProps = { serviceId, timezone, barber, preferredId };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 border-t border-line py-4 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-3">
        <BarberPortrait
          name={barber.name}
          photoUrl={barber.photoUrl}
          className="size-12 shrink-0"
          placeholderClassName="size-12 shrink-0 text-2xl"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={headingId} tabIndex={-1} className="font-display text-2xl leading-tight">
            {barber.name}
          </h2>
          {barber.bioLine && <p className="truncate text-sm text-muted-foreground">{barber.bioLine}</p>}
        </div>
        {preferred && <span className="shrink-0 bg-ink px-2 py-1 text-xs text-surface">{t.preferred}</span>}
      </div>

      {loading ? (
        <ul aria-hidden="true" className="grid grid-cols-4 gap-2">
          {Array.from({ length: placeholderRows * 4 }, (_, i) => (
            <li key={i} className="h-11 bg-disabled" />
          ))}
        </ul>
      ) : slots.length === 0 ? (
        <p className="flex min-h-11 flex-wrap items-center gap-x-3 text-sm">
          <span className="text-muted-foreground">{t.noSlots}</span>
          {day?.next && (
            <a
              href={dayUrl(localDateOf(new Date(day.next), timezone))}
              onClick={(event) => {
                event.preventDefault();
                if (day.next) onSelectDay(localDateOf(new Date(day.next), timezone));
              }}
              className="inline-flex min-h-11 items-center font-medium underline underline-offset-4 hover:no-underline"
            >
              {fillText(t.nextFree, { when: formatNextFree(day.next, timezone) })}
            </a>
          )}
        </p>
      ) : both ? (
        <>
          <SlotGroup title={t.morning} slots={morning} {...groupProps} />
          <SlotGroup title={t.afternoon} slots={afternoon} {...groupProps} />
        </>
      ) : (
        <SlotGroup slots={slots} {...groupProps} />
      )}
    </section>
  );
}

function SlotGroup({
  title,
  slots,
  serviceId,
  timezone,
  barber,
  preferredId,
}: {
  title?: string;
  slots: string[];
  serviceId: string;
  timezone: string;
  barber: WhenBarber;
  preferredId: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      {title && <h3 className="text-sm text-muted-foreground">{title}</h3>}
      <ul className="grid grid-cols-4 gap-2">
        {slots.map((iso, index) => {
          const time = formatSlotTime(iso, timezone);
          return (
            <li
              key={iso}
              // Gli orari compaiono in rapida sequenza (solo se il movimento è ammesso, globals.css).
              style={{ "--appear-index": index } as React.CSSProperties}
              className="appear-in"
            >
              <Link
                href={summaryStepUrl(serviceId, barber.id, iso, preferredId ?? undefined)}
                aria-label={fillText(it.booking.when.slotLabel, { time, barber: barber.name })}
                className="relative flex h-11 items-center justify-center border border-ink text-sm font-medium tabular-nums hover:bg-ink hover:text-surface active:bg-ink active:text-surface"
              >
                {time}
                <SlotPending />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Mentre si apre il riepilogo l'orario toccato diventa pieno, con il segno del tema. */
function SlotPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-ink text-surface">
      <PendingMark className="size-6" />
    </span>
  );
}
