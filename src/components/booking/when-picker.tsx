"use client";

// Il giorno all'apertura si riallinea all'URL anche dopo il ritorno con la cronologia (Next ripristina
// dalla cache la pagina della prima apertura): perché serve, vedi docs/PROGRESS.md, fetta 8e,
// "Indietro" dal riepilogo (2026-10-19). La fila continua di giorni è descritta in ADR 013 (fetta 8f).
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { BarberPortrait } from "@/components/barber-portrait";
import { LinkPending } from "@/components/link-pending";
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
import { nextRequests } from "@/lib/booking/when-queue";
import {
  dayAtScroll,
  firstColumnOffset,
  initialWindow,
  renderWindow,
  rescaleScroll,
  rowDays,
  rowLayout,
  settledDay,
  type RowLayout,
} from "@/lib/booking/when-row";
import { dayCacheReducer, type DayCache, type DayEntry } from "@/lib/booking/when-state";
import { localDateOf } from "@/lib/domain/local-time";

export type WhenBarber = { id: string; name: string; photoUrl: string | null };

/**
 * Richieste di giorni partite e non finite, al massimo (le altre aspettano nella coda della finestra).
 * Una sola, sotto il limite di 3 della SPEC: Next esegue le server action una alla volta, quindi più
 * richieste insieme non vanno più veloci ma restano in fila e, se si tocca un orario, la conferma del
 * riepilogo passa dopo di loro (app-router-instance.js di Next).
 */
const MAX_REQUESTS = 1;
/** Ripiego di scrollend (Safari): la fila è ferma dopo questo tempo senza eventi di scorrimento. */
const SETTLE_MS = 150;
/**
 * I giorni vicini si chiedono solo dopo questo tempo a fila ferma. Le server action di Next partono una
 * alla volta: richieste fatte mentre si scorre o subito prima di toccare un orario farebbero aspettare
 * la conferma del riepilogo. Il giorno selezionato si chiede subito.
 */
const PREFETCH_DELAY_MS = 600;

/** id del nome in testa alla colonna di un barbiere in un giorno (anche destinazione del focus). */
const headingIdOf = (barberId: string, date: string): string => `barber-${barberId}-${date}`;

/** Larghezza di una colonna: 4 nella larghezza utile della fila, qualunque sia il numero di barbieri. */
const COLUMN_WIDTH = "w-[calc((100cqw_-_3*var(--control-gap))/4)] shrink-0";

/**
 * Apertura senza salto: porta la fila sul giorno di data-initial-day prima del primo disegno, mentre la
 * pagina arriva dal server. Contenuto statico: il giorno (già validato dal server) si legge
 * dall'attributo, mai scritto qui dentro. Con una CSP servirà un nonce (ADR 013).
 */
const OPEN_SCRIPT = `(function(){var s=document.currentScript,r=s&&s.previousElementSibling;if(!r)return;var d=r.getAttribute("data-initial-day"),g=r.querySelectorAll("[data-row-day]");for(var i=0;i<g.length;i++){if(g[i].getAttribute("data-row-day")===d){r.scrollLeft=g[i].getBoundingClientRect().left-g[0].getBoundingClientRect().left;return}}})();`;

/** Vero solo nel rendering sul server e durante l'idratazione (lì lo script di apertura esiste già nell'HTML). */
const useFromServer = (): boolean =>
  useSyncExternalStore(
    () => () => {},
    () => false,
    () => true,
  );

/** Il browser ha l'evento scrollend; altrimenti (Safari) la fila è ferma dopo SETTLE_MS senza scorrimento. */
const hasScrollEnd = (): boolean => typeof window !== "undefined" && "onscrollend" in window;

/** Giorno della fila ferma (regola della fine fila in settledDay, when-row.ts). */
const dayOfRow = (el: HTMLElement, layout: RowLayout, chosen: string | null): string =>
  settledDay(
    layout,
    { scrollLeft: el.scrollLeft, maxScrollLeft: el.scrollWidth - el.clientWidth, viewportWidth: el.clientWidth },
    chosen,
  );

const sameDays = (a: string[], b: string[]): boolean => a.length === b.length && a.every((d, i) => d === b[i]);

/**
 * "Quando?" (SPEC §5.2, fette 8e e 8f): striscia dei giorni in alto, "Primo libero" e una fila
 * continua di colonne, per ogni giorno della fila una per barbiere. Il giorno selezionato è quello
 * della colonna più a sinistra visibile: la striscia lo segue a ogni frame, URL e annuncio solo a fila
 * ferma. Si disegnano solo i giorni vicini alla zona visibile (gli altri sono segnaposto della stessa
 * larghezza); i giorni si chiedono uno alla volta, al massimo tre insieme, e restano in memoria.
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
  const fromServer = useFromServer();
  const row = useMemo(() => rowDays(days), [days]);
  // Il giorno da aprire è quello dell'URL, non solo `initialDay`: tornando con la cronologia
  // (indietro dal riepilogo) il router riusa la pagina resa all'apertura, con il giorno di allora,
  // mentre l'URL ha il giorno scelto dopo (replaceState qui sotto). Quel giorno si carica subito.
  const urlDay = useSearchParams().get("giorno");
  const [openDay] = useState(() => {
    const day = dayToOpen(days, urlDay) ?? initialDay.date;
    return row.includes(day) ? day : (row[0] ?? day);
  });
  // Dopo un ritorno con la cronologia `initialDay` è quello dell'apertura, forse superato: non si tiene.
  const [cache, dispatch] = useReducer(dayCacheReducer, undefined, (): DayCache =>
    openDay === initialDay.date ? { [initialDay.date]: { status: "loaded", day: initialDay } } : {},
  );
  /** Giorno della colonna più a sinistra visibile (segue lo scorrimento a ogni frame). */
  const [selected, setSelected] = useState(openDay);
  /** Giorni disegnati; gli altri sono segnaposto. */
  const [drawn, setDrawn] = useState(() => initialWindow(row, openDay, barbers.length));
  /** Fila ferma da PREFETCH_DELAY_MS: si possono chiedere anche i giorni vicini. */
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Giorni da caricare: i visibili e uno per lato. Più stretti dei disegnati perché le server action
   * di Next partono una alla volta: una coda lunga farebbe aspettare la conferma del riepilogo.
   */
  const [near, setNear] = useState(() => {
    const index = row.indexOf(openDay);
    return row.slice(Math.max(0, index - 1), index + 2);
  });
  /** Testo della regione aria-live: il giorno a fila ferma (vuoto all'apertura). */
  const [announcement, setAnnouncement] = useState("");

  const rowRef = useRef<HTMLDivElement>(null);
  /** Primo rendering arrivato dal server (con lo script di apertura nell'HTML). */
  const hydrated = useRef(fromServer);
  const layoutRef = useRef<RowLayout | null>(null);
  /** Giorno di arrivo di uno scorrimento comandato: fino all'arrivo la selezione non segue la fila. */
  const lockRef = useRef<string | null>(null);
  /** Giorno scelto a fila ferma: in fondo alla fila resta selezionato anche se non arriva al bordo. */
  const chosenRef = useRef<string | null>(null);
  /** Ultimo giorno scritto nell'URL e annunciato. */
  const committedRef = useRef<string | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef(0);
  const lastScrollLeft = useRef(0);
  const requestSeq = useRef(0);
  const cacheRef = useRef(cache);
  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);
  /** Intestazione su cui portare il focus (dopo "prossimo: …"), appena è disegnata. */
  const focusAfter = useRef<{ barberId: string; date: string } | null>(null);
  /** Cresce a ogni "prossimo: …": fa ripartire l'effetto del focus anche se la finestra non cambia. */
  const [focusRequest, setFocusRequest] = useState(0);
  /** Larghezza utile della fila (senza i margini interni), misurata con il resto della geometria. */
  const usableWidth = useRef(0);

  const dayUrl = useCallback(
    (date: string) => whenStepUrl(serviceId, { day: date, barberId: preferredId ?? undefined }),
    [serviceId, preferredId],
  );

  const request = useCallback(
    (date: string) => {
      const requestId = ++requestSeq.current;
      dispatch({ type: "request", date, requestId });
      fetchWhenDay({ serviceId, date, barberId: preferredId ?? undefined, recentBarberId: recentId ?? undefined })
        .then((result) =>
          dispatch(
            result.ok
              ? {
                  type: "loaded",
                  date,
                  requestId,
                  day: { date: result.date, firstFree: result.firstFree, barbers: result.barbers },
                }
              : { type: "failed", date, requestId },
          ),
        )
        .catch(() => dispatch({ type: "failed", date, requestId }));
    },
    [serviceId, preferredId, recentId],
  );

  // Coda: prima il giorno selezionato, poi i vicini dal più prossimo; al massimo tre insieme. Un
  // giorno uscito dalla zona visibile prima di partire non parte più (nextRequests).
  useEffect(() => {
    const center = row.indexOf(selected);
    const neighbours = idle ? near : [];
    const wanted = [selected, ...[...neighbours].sort((a, b) => Math.abs(row.indexOf(a) - center) - Math.abs(row.indexOf(b) - center))];
    const entries = Object.entries(cache) as Array<[string, DayEntry]>;
    for (const date of nextRequests({
      wanted,
      inFlight: entries.filter(([, e]) => e.status === "loading").map(([d]) => d),
      cached: entries.filter(([, e]) => e.status !== "loading").map(([d]) => d),
      limit: MAX_REQUESTS,
    })) {
      request(date);
    }
  }, [cache, near, idle, selected, row, request]);

  /** La fila si muove: niente richieste dei giorni vicini finché non si ferma. */
  const pausePrefetch = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    setIdle(false);
  }, []);
  /** La fila è ferma: i giorni vicini si chiedono fra PREFETCH_DELAY_MS. */
  const resumePrefetch = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), PREFETCH_DELAY_MS);
  }, []);
  useEffect(() => () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  /** Misura la fila (colonne, gap, spazio fra i giorni) dal primo e dal secondo giorno disegnati o segnaposto. */
  const measure = useCallback((): RowLayout | null => {
    const el = rowRef.current;
    const groups = el?.querySelectorAll<HTMLElement>("[data-row-day]");
    const first = groups?.[0];
    if (!el || !groups || !first) return null;
    const firstBox = first.getBoundingClientRect();
    const columnWidth = (first.firstElementChild as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
    const count = Math.max(1, barbers.length);
    const gap = count > 1 ? (firstBox.width - count * columnWidth) / (count - 1) : 0;
    const second = groups[1]?.getBoundingClientRect();
    const dayGap = second ? second.left - firstBox.right : 0;
    const style = getComputedStyle(el);
    usableWidth.current = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return rowLayout({ days: row, barberCount: count, columnWidth, gap, dayGap });
  }, [row, barbers.length]);

  /** Fila ferma: il giorno va nell'URL (senza nuove voci) e, se è cambiato, si annuncia. */
  const commit = useCallback(
    (date: string) => {
      if (committedRef.current === date) return;
      const first = committedRef.current === null;
      committedRef.current = date;
      window.history.replaceState(null, "", dayUrl(date));
      if (!first) setAnnouncement(fillText(t.dayAnnounce, { day: formatDayLabel(date) }));
      // Un giorno non caricato si riprova quando torna selezionato, passando dalla coda.
      if (cacheRef.current[date]?.status === "error") dispatch({ type: "retry", date });
    },
    [dayUrl, t.dayAnnounce],
  );

  const settle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    const el = rowRef.current;
    const layout = layoutRef.current;
    if (!el || !layout) return;
    const day = dayOfRow(el, layout, lockRef.current ?? chosenRef.current);
    lockRef.current = null;
    chosenRef.current = day;
    setSelected(day);
    commit(day);
    resumePrefetch();
  }, [commit, resumePrefetch]);

  /** Per ogni frame di scorrimento: giorno selezionato (se non c'è uno scorrimento comandato) e finestra. */
  const update = useCallback(() => {
    frame.current = 0;
    const el = rowRef.current;
    const layout = layoutRef.current;
    if (!el || !layout) return;
    const left = el.scrollLeft;
    lastScrollLeft.current = left;
    const current = lockRef.current ?? dayOfRow(el, layout, chosenRef.current);
    if (!lockRef.current) setSelected(current);
    const around = renderWindow(layout, left, el.clientWidth);
    const next = around.includes(current) ? around : [...around, current].sort();
    setDrawn((previous) => (sameDays(previous, next) ? previous : next));
    const from = Math.max(0, row.indexOf(dayAtScroll(layout, left)) - 1);
    const to = row.indexOf(dayAtScroll(layout, left + usableWidth.current - 1)) + 2;
    const visible = row.slice(from, to);
    setNear((previous) => (sameDays(previous, visible) ? previous : visible));
  }, [row]);

  /** Porta la prima colonna del giorno al bordo sinistro (morbido, istantaneo con il movimento ridotto). */
  const scrollToDay = useCallback(
    (date: string, smooth = true): boolean => {
      const el = rowRef.current;
      const layout = layoutRef.current;
      if (!el || !layout || !row.includes(date)) return false;
      lockRef.current = date;
      pausePrefetch();
      setSelected(date);
      setDrawn((previous) => (previous.includes(date) ? previous : [...previous, date].sort()));
      // Le colonne del giorno di arrivo partono dall'inizio.
      for (const list of el.querySelectorAll<HTMLElement>(`section[data-day="${date}"] [data-slots]`)) list.scrollTop = 0;
      const left = Math.min(firstColumnOffset(layout, date), el.scrollWidth - el.clientWidth);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (Math.abs(el.scrollLeft - left) < 1) {
        settle();
        return true;
      }
      el.scrollTo({ left, behavior: smooth && !reduced ? "smooth" : "instant" });
      // Ripiego se lo scorrimento non parte o non finisce con un evento (per esempio già al limite).
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(settle, smooth && !reduced ? 1000 : SETTLE_MS);
      return true;
    },
    [row, settle, pausePrefetch],
  );

  // Misura iniziale, posizione del giorno di apertura (se lo script non l'ha già fatto, per esempio
  // dopo un ritorno con la cronologia reso sul client) e URL.
  useLayoutEffect(() => {
    const el = rowRef.current;
    const layout = measure();
    if (!el || !layout) return;
    layoutRef.current = layout;
    // Idratazione: lo script dell'HTML ha già portato la fila sul giorno e l'utente può averla già
    // mossa, quindi non si tocca. Rendering sul client (ritorno con la cronologia): si posiziona qui.
    if (!hydrated.current) el.scrollLeft = firstColumnOffset(layout, openDay);
    lastScrollLeft.current = el.scrollLeft;
    update();
    // Il giorno visibile ora: la fila può essere già stata scorsa prima dell'idratazione.
    const day = dayOfRow(el, layout, openDay);
    chosenRef.current = day;
    setSelected(day);
    commit(day);
    resumePrefetch();
    // Solo all'apertura: dopo, la fila la muovono lo scorrimento e scrollToDay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Eventi della fila: scorrimento (una lettura di scrollLeft per frame), fine dello scorrimento
  // (scrollend, o 150 ms senza eventi per Safari) e interventi dell'utente, che sbloccano subito uno
  // scorrimento comandato in corso.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const onScroll = () => {
      if (!frame.current) frame.current = requestAnimationFrame(update);
      pausePrefetch();
      // Con scrollend la fine la segna il browser (anche dopo uno scorrimento comandato già partito).
      if (hasScrollEnd()) {
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = null;
        return;
      }
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(settle, SETTLE_MS);
    };
    const release = () => {
      lockRef.current = null;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", settle);
    el.addEventListener("pointerdown", release, { passive: true });
    el.addEventListener("wheel", release, { passive: true });
    el.addEventListener("keydown", release);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", settle);
      el.removeEventListener("pointerdown", release);
      el.removeEventListener("wheel", release);
      el.removeEventListener("keydown", release);
      if (frame.current) cancelAnimationFrame(frame.current);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [update, settle, pausePrefetch]);

  // Larghezza cambiata (rotazione, finestra, testo ingrandito): resta la stessa colonna a sinistra.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const before = layoutRef.current;
      const after = measure();
      if (!after) return;
      layoutRef.current = after;
      if (before && (before.columns[0]?.end !== after.columns[0]?.end || before.width !== after.width)) {
        el.scrollLeft = lockRef.current
          ? firstColumnOffset(after, lockRef.current)
          : rescaleScroll(before, after, lastScrollLeft.current);
      }
      update();
    });
    // La fila (rotazione, finestra) e il primo giorno, sempre presente: con il solo testo ingrandito
    // la fila resta larga uguale ma cambiano colonne e spazi.
    observer.observe(el);
    const firstDay = el.querySelector("[data-row-day]");
    if (firstDay) observer.observe(firstDay);
    return () => observer.disconnect();
  }, [measure, update]);

  // Dopo "prossimo: …" il focus va sull'intestazione del barbiere nel giorno di arrivo (sempre: la
  // colonna è disegnata da scrollToDay), senza interrompere lo scorrimento della fila.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    const heading = document.getElementById(headingIdOf(target.barberId, target.date));
    if (!heading) return;
    focusAfter.current = null;
    heading.focus({ preventScroll: true });
  }, [focusRequest, drawn]);

  const index = row.indexOf(selected);
  const step = (delta: number) => {
    const date = row[index + delta];
    if (date) scrollToDay(date);
  };

  const onRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    step(event.key === "ArrowRight" ? 1 : -1);
  };

  const drawnSet = new Set(drawn);
  const selectedEntry = cache[selected];
  const first =
    selectedEntry?.status === "loaded"
      ? firstFreeAmong(
          selectedEntry.day,
          barbers.map((b) => b.id),
        )
      : null;
  const firstBarber = first ? barbers.find((b) => b.id === first.barberId) : undefined;

  return (
    <div className="flex flex-col gap-3 tall:min-h-0 tall:flex-1">
      <DayStrip days={days} selected={selected} dayUrl={dayUrl} onSelect={(date) => scrollToDay(date)} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* Altezza fissa: con o senza "Primo libero" (e durante il caricamento) le colonne non si spostano. */}
      <div className="h-12 shrink-0">
        {selectedEntry?.status === "error" ? (
          <p role="alert" className="flex h-12 items-center border-l-2 border-destructive pl-3 text-destructive">
            {it.booking.errors.generic}
          </p>
        ) : selectedEntry?.status !== "loaded" ? (
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

      {/* @container: la larghezza delle colonne si calcola sulla larghezza utile (senza i margini). */}
      <div className="relative @container flex flex-col tall:min-h-0 tall:flex-1">
        <DayButton side="prev" disabled={index <= 0} onClick={() => step(-1)} />
        <DayButton side="next" disabled={index < 0 || index >= row.length - 1} onClick={() => step(1)} />
        <div
          ref={rowRef}
          role="region"
          aria-label={t.rowLabel}
          // Focusabile: la fila scorre e su desktop ←/→ cambiano giorno.
          tabIndex={0}
          onKeyDown={onRowKeyDown}
          data-when-columns=""
          data-initial-day={openDay}
          // Sborda fino ai bordi dello schermo; scroll-padding: la colonna agganciata parte dal margine.
          // Aggancio morbido (proximity), mai obbligato: si scorre anche di molte colonne alla volta.
          className="relative -mx-4 flex snap-x scroll-pl-4 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 tall:min-h-0 tall:flex-1"
        >
          {row.map((date, i) => {
            // Fra un giorno e il successivo uno spazio più largo con una linea sottile al centro.
            const divider =
              i > 0
                ? "relative ml-day before:absolute before:inset-y-0 before:left-[calc(var(--day-gap)/-2)] before:w-px before:bg-day-divider"
                : "";
            return drawnSet.has(date) ? (
              <div key={date} data-row-day={date} data-day={date} className={`flex shrink-0 gap-control ${divider}`}>
                {barbers.map((barber) => (
                  <BarberColumn
                    key={barber.id}
                    serviceId={serviceId}
                    timezone={timezone}
                    barber={barber}
                    date={date}
                    entry={cache[date]}
                    appear={date === openDay}
                    preferred={barber.id === preferredId}
                    preferredId={preferredId}
                    dayUrl={dayUrl}
                    onSelectDay={(next) => {
                      // Il focus si sposta solo se la fila parte davvero verso quel giorno.
                      if (!scrollToDay(next)) return;
                      focusAfter.current = { barberId: barber.id, date: next };
                      setFocusRequest((n) => n + 1);
                    }}
                  />
                ))}
              </div>
            ) : (
              // Segnaposto della stessa larghezza (punti di aggancio compresi): la posizione non salta.
              <div key={date} data-row-day={date} data-day={date} aria-hidden="true" className={`flex shrink-0 gap-control ${divider}`}>
                {barbers.map((barber) => (
                  <div key={barber.id} className={`${COLUMN_WIDTH} snap-start`} />
                ))}
              </div>
            );
          })}
        </div>
        {/* Solo nell'HTML del server: sul client React non esegue gli script (e lo segnala). */}
        {fromServer && <script dangerouslySetInnerHTML={{ __html: OPEN_SCRIPT }} />}
      </div>
    </div>
  );
}

/** "Giorno precedente/successivo" ai lati della fila, fuori dall'area che scorre (solo su desktop). */
function DayButton({ side, disabled, onClick }: { side: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  const t = it.booking.when;
  const Icon = side === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={side === "prev" ? t.prevDay : t.nextDay}
      disabled={disabled}
      onClick={onClick}
      className={`glow-hover absolute top-1/2 z-10 hidden size-11 -translate-y-1/2 items-center justify-center rounded-control border border-control-rest hover:border-ink disabled:border-line disabled:text-ink-disabled disabled:shadow-none lg:flex ${
        side === "prev" ? "-left-16" : "-right-16"
      }`}
    >
      <Icon aria-hidden="true" className="size-5" />
    </button>
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

  // Il giorno selezionato entra nella striscia (inline nearest), senza muovere la pagina né il focus.
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="date"]');
    if (!list || !current) return;
    const left = current.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (left + current.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = left + current.offsetWidth - list.clientWidth;
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
          const box = "relative flex h-12 w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-control border";
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
 * Colonna di un barbiere in un giorno: testata fissa (data, ritratto, nome, "Il tuo") e orari uno per
 * riga. Sugli schermi alti la lista scorre da sola (senza trascinare le altre colonne, la fila né la
 * pagina) e una sfumatura in fondo segnala gli orari nascosti sotto.
 */
function BarberColumn({
  serviceId,
  timezone,
  barber,
  date,
  entry,
  appear,
  preferred,
  preferredId,
  dayUrl,
  onSelectDay,
}: {
  serviceId: string;
  timezone: string;
  barber: WhenBarber;
  date: string;
  /** Stato del giorno: assente o in caricamento, caricato, in errore. */
  entry: DayEntry | undefined;
  /** Comparsa in sequenza degli orari (solo il giorno di apertura). */
  appear: boolean;
  preferred: boolean;
  /** Preferito dall'URL, portato al riepilogo per "Indietro" e "Cambia orario". */
  preferredId: string | null;
  dayUrl: (date: string) => string;
  onSelectDay: (date: string) => void;
}) {
  const t = it.booking.when;
  const listRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const loaded = entry?.status === "loaded";
  // Assente nei dati: il barbiere non ha righe nel periodo (nessun orario di lavoro).
  const day: WhenBarberDay | undefined = loaded ? entry.day.barbers.find((b) => b.barberId === barber.id) : undefined;
  const slots = useMemo(() => day?.slots ?? [], [day]);
  const { morning, afternoon } = splitByPeriod(slots, timezone);
  const parts = dayParts(date);

  const updateMoreBelow = useCallback(() => {
    const list = listRef.current;
    if (list) setMoreBelow(list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  }, []);

  // La sfumatura dipende dal contenuto e dall'altezza disponibile (rotazione, barra del browser).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    updateMoreBelow();
    const observer = new ResizeObserver(updateMoreBelow);
    observer.observe(list);
    return () => observer.disconnect();
  }, [updateMoreBelow, slots, entry?.status]);

  const slotProps = { serviceId, timezone, barber, preferredId, appear };

  return (
    <section
      role="group"
      aria-label={fillText(t.columnLabel, { name: barber.name, day: formatDayLabel(date) })}
      data-day={date}
      data-barber={barber.id}
      className={`@container flex snap-start flex-col tall:min-h-0 ${COLUMN_WIDTH}`}
    >
      {/* Altezza uguale per tutte le colonne: "Il tuo" sta sull'angolo del ritratto, non su una riga sua. */}
      <div className="flex flex-col items-center gap-1 border-b border-line pb-1.5">
        {/* Il giorno è già nel nome del gruppo: qui solo a vista. */}
        <p aria-hidden="true" className="text-xs leading-none text-muted-foreground">
          <span>{parts.weekday}</span> <span className="tabular-nums">{parts.day}</span>{" "}
        </p>
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
          id={headingIdOf(barber.id, date)}
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
          data-slots=""
          onScroll={updateMoreBelow}
          // relative: anche i testi sr-only (assoluti) restano dentro la colonna che scorre.
          // scroll-pb-10: un orario raggiunto da tastiera non finisce sotto la sfumatura in fondo.
          // overflow-x-hidden: di lato scorre solo la fila; overscroll contain: il gesto verticale
          // resta alla colonna (su iOS non passa alla pagina).
          className="relative flex scroll-pb-10 flex-col gap-control overflow-x-hidden py-2 tall:min-h-0 tall:flex-1 tall:overflow-y-auto tall:overscroll-contain"
        >
          {entry?.status === "error" ? (
            <p className="text-xs text-muted-foreground">{t.dayError}</p>
          ) : !loaded ? (
            // Caricamento: poche righe leggere al posto degli orari (la testata resta uguale).
            <ul aria-hidden="true" className="flex flex-col gap-control">
              {Array.from({ length: 4 }, (_, i) => (
                <li key={i} className="h-11 shrink-0 rounded-control bg-disabled" />
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
  appear,
}: {
  slots: string[];
  /** Posizione del primo orario nella colonna, per la comparsa in sequenza. */
  offset?: number;
  serviceId: string;
  timezone: string;
  barber: WhenBarber;
  preferredId: string | null;
  appear: boolean;
}) {
  if (slots.length === 0) return null;
  return (
    <ul className="flex flex-col gap-control">
      {slots.map((iso, index) => {
        const time = formatSlotTime(iso, timezone);
        return (
          <li
            key={iso}
            // Gli orari del giorno di apertura compaiono in rapida sequenza (solo se il movimento è
            // ammesso, globals.css); gli altri giorni compaiono fermi, così lo scorrimento resta leggero.
            style={appear ? ({ "--appear-index": offset + index } as React.CSSProperties) : undefined}
            className={appear ? "appear-in" : undefined}
          >
            <Link
              href={summaryStepUrl(serviceId, barber.id, iso, preferredId ?? undefined)}
              // Gli orari sono decine, ognuno con il suo URL: niente prefetch (ognuno passerebbe dal
              // proxy). Il riscontro al tocco lo dà il segno d'attesa nello slot (LinkPending).
              prefetch={false}
              aria-label={fillText(it.booking.when.slotLabel, { time, barber: barber.name })}
              className="glow-hover relative flex h-11 items-center justify-center rounded-control border border-control-rest bg-surface-control text-sm font-medium tabular-nums hover:border-ink hover:bg-ink hover:text-surface focus-visible:border-ink active:border-ink active:bg-ink active:text-surface"
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
