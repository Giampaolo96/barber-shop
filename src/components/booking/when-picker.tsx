"use client";

import Link, { useLinkStatus } from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BarberPortrait } from "@/components/barber-portrait";
import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import type { DayStatus } from "@/lib/availability";
import type { WhenBarberDay, WhenDay } from "@/lib/booking/availability";
import { fetchWhenDay } from "@/lib/booking/availability-actions";
import { dayParts, formatDayLabel } from "@/lib/booking/format";
import { summaryStepUrl, whenStepUrl } from "@/lib/booking/paths";
import { formatNextFree, formatSlotTime, splitByPeriod } from "@/lib/booking/when";
import { localDateOf } from "@/lib/domain/local-time";
import { PendingMark } from "@/themes/active";

export type WhenBarber = { id: string; name: string; photoUrl: string | null; bioLine: string | null };

/**
 * "Quando?" (SPEC §5.2, fetta 8e): striscia dei giorni fissa in alto, "Primo libero" e una sezione
 * per barbiere con gli orari del giorno scelto. I giorni e gli orari sono link (funzionano anche
 * prima dell'idratazione); dopo, il cambio di giorno chiede solo quel giorno, tiene in memoria i
 * giorni già visti e prepara il successivo. Durante il caricamento le sezioni restano al loro posto.
 */
export function WhenPicker({
  serviceId,
  timezone,
  preferredId,
  barbers,
  days,
  initialDay,
}: {
  serviceId: string;
  timezone: string;
  /** Barbiere arrivato dall'URL: sezione evidenziata e precedenza nel "Primo libero". */
  preferredId: string | null;
  /** Già nell'ordine delle sezioni. */
  barbers: WhenBarber[];
  days: DayStatus[];
  initialDay: WhenDay;
}) {
  const t = it.booking.when;
  const [selected, setSelected] = useState(initialDay.date);
  const [shown, setShown] = useState<WhenDay>(initialDay);
  const [error, setError] = useState(false);
  /** Ultimo giorno toccato: una risposta arrivata in ritardo per un altro giorno si ignora. */
  const latest = useRef(initialDay.date);
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
        request = fetchWhenDay({ serviceId, date, barberId: preferredId ?? undefined })
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
    [serviceId, preferredId],
  );

  // Il giorno mostrato finisce sempre nell'URL (anche all'apertura senza `giorno`), senza nuove voci
  // nella cronologia. Poi si prepara il giorno selezionabile successivo.
  useEffect(() => {
    window.history.replaceState(null, "", dayUrl(shown.date));
    const next = days.find((d) => d.date > shown.date && d.status !== "closed");
    if (next) void load(next.date);
  }, [shown.date, days, dayUrl, load]);

  const selectDay = (date: string) => {
    latest.current = date;
    setSelected(date);
    setError(false);
    const cached = cache.current.get(date);
    if (cached) {
      setShown(cached);
      return;
    }
    void load(date).then((day) => {
      if (latest.current !== date) return;
      if (day) setShown(day);
      else setError(true);
    });
  };

  const loading = selected !== shown.date && !error;
  const byId = new Map(shown.barbers.map((b) => [b.barberId, b]));
  const firstFreeBarber = shown.firstFree ? barbers.find((b) => b.id === shown.firstFree?.barberId) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <DayStrip days={days} selected={selected} dayUrl={dayUrl} onSelect={selectDay} />

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
            ) : shown.firstFree && firstFreeBarber ? (
              <Link
                href={summaryStepUrl(serviceId, firstFreeBarber.id, shown.firstFree.startsAt)}
                className="on-ink relative flex h-14 items-center border border-ink bg-ink px-4 font-medium text-surface transition-colors hover:bg-surface hover:text-ink active:bg-surface active:text-ink"
              >
                {fillText(t.firstFree, {
                  time: formatSlotTime(shown.firstFree.startsAt, timezone),
                  barber: firstFreeBarber.name,
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
                loading={loading}
                dayUrl={dayUrl}
                onSelectDay={selectDay}
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
    <nav
      aria-label={t.time.daysLabel}
      className="sticky top-0 z-10 -mx-4 border-b border-line bg-surface px-4 pt-2"
    >
      <ul ref={listRef} onKeyDown={onKeyDown} className="flex gap-2 overflow-x-auto pb-2">
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
                  className={`${box} ${
                    day.status === "open" ? "border-ink" : "border-dashed border-ink-disabled text-ink-disabled"
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
  loading: boolean;
  dayUrl: (date: string) => string;
  onSelectDay: (date: string) => void;
}) {
  const t = it.booking.when;
  const headingId = `barber-${barber.id}`;
  // Durante il caricamento `day` è ancora quello del giorno precedente: lo scheletro ne tiene le righe.
  const slots = day?.slots ?? [];
  const placeholderRows = Math.max(1, Math.ceil(slots.length / 4));

  const { morning, afternoon } = splitByPeriod(slots, timezone);
  const both = morning.length > 0 && afternoon.length > 0;

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
          <h2 id={headingId} className="font-display text-2xl leading-tight">
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
          <SlotGroup title={t.morning} slots={morning} serviceId={serviceId} timezone={timezone} barber={barber} />
          <SlotGroup title={t.afternoon} slots={afternoon} serviceId={serviceId} timezone={timezone} barber={barber} />
        </>
      ) : (
        <SlotGroup slots={slots} serviceId={serviceId} timezone={timezone} barber={barber} />
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
}: {
  title?: string;
  slots: string[];
  serviceId: string;
  timezone: string;
  barber: WhenBarber;
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
                href={summaryStepUrl(serviceId, barber.id, iso)}
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
