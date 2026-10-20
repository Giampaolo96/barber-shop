"use client";

// Il giorno all'apertura si riallinea all'URL anche dopo il ritorno con la cronologia (Next ripristina
// dalla cache la pagina della prima apertura): perché serve, vedi docs/PROGRESS.md, fetta 8e,
// "Indietro" dal riepilogo (2026-10-19).
import Link from "next/link";
import { LinkPending } from "@/components/link-pending";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BarberPortrait } from "@/components/barber-portrait";
import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import type { DayStatus } from "@/lib/availability";
import type { WhenBarberDay, WhenDay } from "@/lib/booking/availability";
import { fetchWhenDay } from "@/lib/booking/availability-actions";
import { dayParts, formatDayLabel } from "@/lib/booking/format";
import { summaryStepUrl, whenStepUrl } from "@/lib/booking/paths";
import {
  firstFreeAmong,
  formatNextFree,
  formatNextFreeDay,
  formatSlotTime,
  initialDay as dayToOpen,
  splitByPeriod,
} from "@/lib/booking/when";
import { isWhenLoading, whenReducer } from "@/lib/booking/when-state";
import { localDateOf } from "@/lib/domain/local-time";

export type WhenBarber = { id: string; name: string; photoUrl: string | null };

/** id del nome in testa alla colonna di un barbiere (anche destinazione del focus). */
const headingIdOf = (barberId: string): string => `barber-${barberId}`;

/**
 * "Quando?" (SPEC §5.2, fetta 8e): striscia dei giorni fissa in alto, "Primo libero" e una colonna
 * per barbiere, affiancate, con gli orari del giorno scelto. I giorni e gli orari sono link (funzionano anche
 * prima dell'idratazione); dopo, il cambio di giorno chiede solo quel giorno, tiene in memoria i
 * giorni già visti e prepara il successivo. Durante il caricamento le colonne restano al loro posto;
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
  /** Barbiere arrivato dall'URL: colonna evidenziata e precedenza nel "Primo libero". */
  preferredId: string | null;
  /** Barbiere dell'ultimo appuntamento: precedenza nel "Primo libero" dopo il preferito. */
  recentId: string | null;
  /** Già nell'ordine delle colonne. */
  barbers: WhenBarber[];
  days: DayStatus[];
  initialDay: WhenDay;
}) {
  const t = it.booking.when;
  // Il giorno da aprire è quello dell'URL, non solo `initialDay`: tornando con la cronologia
  // (indietro dal riepilogo) il router riusa la pagina resa all'apertura, con il giorno di allora,
  // mentre l'URL ha il giorno scelto dopo (replaceState qui sotto). Quel giorno si carica subito.
  const urlDay = useSearchParams().get("giorno");
  const [openDay] = useState(() => dayToOpen(days, urlDay) ?? initialDay.date);
  const [view, dispatch] = useReducer(whenReducer, { selected: openDay, shown: initialDay, error: false });
  const { selected, shown, error } = view;
  /** Testo della regione aria-live: il giorno scelto (vuoto all'apertura). */
  const [announcement, setAnnouncement] = useState("");
  /** Colonna su cui portare il focus quando arriva il giorno (dopo "prossimo: …"). */
  const focusAfterLoad = useRef<string | null>(null);
  // Dopo un ritorno con la cronologia `initialDay` è quello dell'apertura, forse superato: non si tiene.
  const cache = useRef(new Map<string, WhenDay>(openDay === initialDay.date ? [[initialDay.date, initialDay]] : []));
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

  useEffect(() => {
    if (openDay !== initialDay.date) void load(openDay).then((day) => dispatch({ type: "loaded", date: openDay, day }));
  }, [openDay, initialDay.date, load]);

  // Il giorno selezionato finisce sempre nell'URL (anche all'apertura senza `giorno`), senza nuove
  // voci nella cronologia: "Indietro" e il ritorno con la cronologia lo ritrovano.
  useEffect(() => {
    window.history.replaceState(null, "", dayUrl(selected));
  }, [selected, dayUrl]);

  // Si prepara il giorno selezionabile successivo a quello mostrato (non durante un caricamento).
  useEffect(() => {
    if (selected !== shown.date) return;
    const next = days.find((d) => d.date > shown.date && d.status !== "closed");
    if (next) void load(next.date);
  }, [selected, shown.date, days, load]);

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
    <div className="flex flex-col gap-3 tall:min-h-0 tall:flex-1">
      <DayStrip days={days} selected={selected} dayUrl={dayUrl} onSelect={(date) => selectDay(date)} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {error ? (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
          {it.booking.errors.generic}
        </p>
      ) : (
        <div aria-busy={loading} className="flex flex-col gap-3 tall:min-h-0 tall:flex-1">
          {/* Altezza fissa: con o senza "Primo libero" (e durante il caricamento) le colonne non si spostano. */}
          <div className="h-12 shrink-0">
            {loading ? (
              <div aria-hidden="true" className="h-12 bg-disabled" />
            ) : first && firstBarber ? (
              <Link
                href={summaryStepUrl(serviceId, firstBarber.id, first.startsAt, preferredId ?? undefined)}
                className="on-ink emphasis glow text-glow relative flex h-12 items-center border border-ink px-4 font-medium"
              >
                {fillText(t.firstFree, {
                  time: formatSlotTime(first.startsAt, timezone),
                  barber: firstBarber.name,
                })}
                <LinkPending />
              </Link>
            ) : (
              <p className="flex h-12 items-center text-muted-foreground">{t.noSlots}</p>
            )}
          </div>

          <div
            aria-label={t.barbersLabel}
            role="group"
            data-when-columns=""
            // Fino a 4 barbieri colonne uguali; oltre, larghezza minima (a 390 px la quinta sporge di quasi
            // 2 rem dal bordo, così si capisce che l'area scorre) e scorrimento orizzontale con snap.
            className={`grid min-w-0 grid-flow-col gap-1.5 tall:min-h-0 tall:flex-1 tall:grid-rows-1 ${
              barbers.length > 4
                ? "-mx-4 auto-cols-[minmax(5rem,1fr)] snap-x snap-mandatory scroll-px-4 overflow-x-auto overscroll-x-contain px-4"
                : "auto-cols-fr"
            }`}
          >
            {barbers.map((barber) => (
              <BarberColumn
                key={barber.id}
                serviceId={serviceId}
                timezone={timezone}
                barber={barber}
                day={byId.get(barber.id)}
                date={shown.date}
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
    <nav aria-label={t.time.daysLabel} className="sticky-bar sticky top-0 z-10 -mx-4 border-b border-line px-3 pt-1">
      {/* p-1: il contorno del focus (2 px staccato di 2 px) non viene tagliato dallo scorrimento. */}
      <ul ref={listRef} onKeyDown={onKeyDown} className="flex gap-2 overflow-x-auto p-1 pb-2">
        {days.map((day, index) => {
          const parts = dayParts(day.date);
          // Il mese solo sul primo giorno e quando cambia, accanto al numero: la casella resta bassa.
          const showMonth = index === 0 || parts.day === "1";
          const content = (
            <span aria-hidden="true" className="contents">
              <span className="text-xs leading-none">{parts.weekday}</span>
              <span className="flex items-baseline gap-0.5">
                <span className="font-display text-xl leading-none tabular-nums">{parts.day}</span>
                {showMonth && <span className="text-[0.625rem] leading-none">{parts.month}</span>}
              </span>
            </span>
          );
          const label = formatDayLabel(day.date);
          // relative: il testo sr-only resta dentro la striscia che scorre (niente scroll della pagina).
          const box = "relative flex h-12 w-14 shrink-0 flex-col items-center justify-center gap-1 border";
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
                    day.status === "open" ? "border-control-rest" : "border-dashed border-control-rest text-muted-foreground"
                  } glow-hover hover:border-ink hover:bg-disabled focus-visible:border-ink aria-[current=date]:border-solid aria-[current=date]:border-ink aria-[current=date]:bg-ink aria-[current=date]:text-surface`}
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

/**
 * Colonna di un barbiere: testata fissa (ritratto, nome, "Il tuo") e orari del giorno uno per riga.
 * Sugli schermi alti la lista scorre da sola (senza trascinare le altre colonne né la pagina) e una
 * sfumatura in fondo segnala gli orari nascosti sotto.
 */
function BarberColumn({
  serviceId,
  timezone,
  barber,
  day,
  date,
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
  /** Giorno selezionato: al cambio la colonna torna in cima. */
  date: string;
  preferred: boolean;
  /** Preferito dall'URL, portato al riepilogo per "Indietro" e "Cambia orario". */
  preferredId: string | null;
  loading: boolean;
  dayUrl: (date: string) => string;
  onSelectDay: (date: string) => void;
}) {
  const t = it.booking.when;
  const headingId = headingIdOf(barber.id);
  const listRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  // Durante il caricamento `day` è ancora quello del giorno precedente: lo scheletro ne tiene le righe.
  const slots = useMemo(() => day?.slots ?? [], [day]);
  const { morning, afternoon } = splitByPeriod(slots, timezone);

  const updateMoreBelow = useCallback(() => {
    const list = listRef.current;
    if (list) setMoreBelow(list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  }, []);

  // Cambiando giorno la colonna torna in cima; non all'idratazione (lo scorrimento già fatto resta).
  const shownDate = useRef(date);
  useEffect(() => {
    if (shownDate.current === date) return;
    shownDate.current = date;
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [date]);

  // La sfumatura dipende dal contenuto e dall'altezza disponibile (rotazione, barra del browser).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    updateMoreBelow();
    const observer = new ResizeObserver(updateMoreBelow);
    observer.observe(list);
    return () => observer.disconnect();
  }, [updateMoreBelow, slots, loading]);

  const slotProps = { serviceId, timezone, barber, preferredId };

  return (
    <section
      aria-label={fillText(t.columnLabel, { name: barber.name })}
      className="@container flex min-w-0 snap-start flex-col tall:min-h-0"
    >
      {/* Altezza uguale per tutte le colonne: "Il tuo" sta sull'angolo del ritratto, non su una riga sua. */}
      <div className="flex flex-col items-center gap-1.5 border-b border-line pb-1.5">
        <span className="relative">
          <BarberPortrait
            name={barber.name}
            photoUrl={barber.photoUrl}
            className="size-8 shrink-0"
            placeholderClassName="size-8 shrink-0 text-lg"
          />
          {preferred && (
            <span
              aria-hidden="true"
              className="absolute -right-4 -bottom-1.5 whitespace-nowrap bg-ink px-1 text-[0.625rem] leading-3.5 text-surface"
            >
              {t.preferredShort}
            </span>
          )}
        </span>
        <h2
          id={headingId}
          tabIndex={-1}
          title={barber.name}
          className={`w-full truncate text-center text-sm leading-tight ${preferred ? "font-semibold" : "font-medium"}`}
        >
          {barber.name}
          {/* Per lo screen reader "Il tuo barbiere" arriva dopo il nome, dentro l'intestazione. */}
          {preferred && <span className="sr-only">, {t.preferred}</span>}
        </h2>
      </div>

      <div className="relative flex flex-col tall:min-h-0 tall:flex-1">
        <div
          ref={listRef}
          onScroll={updateMoreBelow}
          // relative: anche i testi sr-only (assoluti) restano dentro la colonna che scorre.
          // scroll-pb-10: un orario raggiunto da tastiera non finisce sotto la sfumatura in fondo.
          className="relative flex scroll-pb-10 flex-col gap-1.5 py-2 tall:min-h-0 tall:flex-1 tall:overflow-y-auto tall:overscroll-contain"
        >
          {loading ? (
            <ul aria-hidden="true" className="flex flex-col gap-1.5">
              {Array.from({ length: Math.max(1, slots.length) }, (_, i) => (
                <li key={i} className="h-11 shrink-0 bg-disabled" />
              ))}
            </ul>
          ) : slots.length === 0 ? (
            <NoSlots day={day} timezone={timezone} dayUrl={dayUrl} onSelectDay={onSelectDay} />
          ) : (
            <>
              <SlotList slots={morning} {...slotProps} />
              {morning.length > 0 && afternoon.length > 0 && (
                <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
                  <span aria-hidden="true" className="h-px flex-1 bg-line" />
                  <span className="sr-only">{t.afternoon}</span>
                  <span aria-hidden="true" className="@min-[5.5rem]:hidden">
                    {t.afternoonShort}
                  </span>
                  <span aria-hidden="true" className="hidden @min-[5.5rem]:inline">
                    {t.afternoon}
                  </span>
                  <span aria-hidden="true" className="h-px flex-1 bg-line" />
                </div>
              )}
              <SlotList slots={afternoon} offset={morning.length} {...slotProps} />
            </>
          )}
        </div>
        {moreBelow && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent"
          />
        )}
      </div>
    </section>
  );
}

/** Colonna senza orari: "Nessun orario" e, se c'è, il link al prossimo orario libero. */
function NoSlots({
  day,
  timezone,
  dayUrl,
  onSelectDay,
}: {
  day: WhenBarberDay | undefined;
  timezone: string;
  dayUrl: (date: string) => string;
  onSelectDay: (date: string) => void;
}) {
  const t = it.booking.when;
  const next = day?.next;
  if (!next) return <p className="text-sm text-muted-foreground">{t.columnNoSlots}</p>;
  // Nome completo "mar 20, 9:30"; a vista nella colonna stretta l'ora si mostra solo se ci sta.
  const nextFull = formatNextFree(next, timezone);
  const nextDate = localDateOf(new Date(next), timezone);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-muted-foreground">{t.columnNoSlots}</p>
      <a
        href={dayUrl(nextDate)}
        aria-label={fillText(t.nextFree, { when: nextFull })}
        onClick={(event) => {
          event.preventDefault();
          onSelectDay(nextDate);
        }}
        className="inline-flex min-h-11 flex-col items-start justify-center font-medium underline underline-offset-4 hover:no-underline"
      >
        {/* "prossimo:" sopra, giorno e ora sotto su una riga sola: mai una virgola a inizio riga. */}
        {/* Lo spazio non conta nel layout a colonna ma tiene il testo "prossimo: …" come in it.booking.when.nextFree. */}
        <span>{t.nextFreeLead}</span>{" "}
        <span className="whitespace-nowrap">
          {formatNextFreeDay(next, timezone)}
          <span className="hidden @min-[6rem]:inline">, {formatSlotTime(next, timezone)}</span>
        </span>
      </a>
    </div>
  );
}

/** Orari liberi uno per riga, larghi quanto la colonna. */
function SlotList({
  slots,
  offset = 0,
  serviceId,
  timezone,
  barber,
  preferredId,
}: {
  slots: string[];
  /** Posizione del primo orario nella colonna, per la comparsa in sequenza. */
  offset?: number;
  serviceId: string;
  timezone: string;
  barber: WhenBarber;
  preferredId: string | null;
}) {
  if (slots.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {slots.map((iso, index) => {
        const time = formatSlotTime(iso, timezone);
        return (
          <li
            key={iso}
            // Gli orari compaiono in rapida sequenza (solo se il movimento è ammesso, globals.css).
            style={{ "--appear-index": offset + index } as React.CSSProperties}
            className="appear-in"
          >
            <Link
              href={summaryStepUrl(serviceId, barber.id, iso, preferredId ?? undefined)}
              // Gli orari sono decine, ognuno con il suo URL: niente prefetch (ognuno passerebbe dal
              // proxy). Il riscontro al tocco lo dà il segno d'attesa nello slot (SlotPending).
              prefetch={false}
              aria-label={fillText(it.booking.when.slotLabel, { time, barber: barber.name })}
              className="glow-hover relative flex h-11 items-center justify-center border border-control-rest text-sm font-medium tabular-nums hover:border-ink hover:bg-ink hover:text-surface focus-visible:border-ink active:border-ink active:bg-ink active:text-surface"
            >
              {time}
              <LinkPending />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
