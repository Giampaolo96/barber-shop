// Conto alla rovescia della prossima prenotazione e "Ci vediamo <giorno>" (fetta 8b). Logica pura:
// giorni di CALENDARIO nella timezone del negozio, mai blocchi di 24 ore né l'ora del server.
import { it as itLocale } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { it } from "@/i18n/it";
import { localDateOf } from "@/lib/domain/local-time";

export type Countdown = { kind: "today" } | { kind: "tomorrow" } | { kind: "days"; days: number };

/** Giorni di calendario tra il giorno locale di `now` e quello di `startsAt`. */
function calendarDaysBetween(startsAt: Date | string, now: Date, timezone: string): number {
  const toUtcDay = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const diff = toUtcDay(localDateOf(new Date(startsAt), timezone)) - toUtcDay(localDateOf(now, timezone));
  return Math.round(diff / 86_400_000);
}

export function bookingCountdown(startsAt: Date | string, now: Date, timezone: string): Countdown {
  const days = calendarDaysBetween(startsAt, now, timezone);
  if (days <= 0) return { kind: "today" };
  if (days === 1) return { kind: "tomorrow" };
  return { kind: "days", days };
}

/** "oggi", "domani", "sabato" entro 6 giorni, poi "il 24 ottobre" ("l'8 ottobre", "il 1° novembre"). */
export function seeYouPhrase(startsAt: Date | string, now: Date, timezone: string): string {
  const t = it.booking.confirmation;
  const instant = new Date(startsAt);
  const days = calendarDaysBetween(instant, now, timezone);
  if (days <= 0) return t.today;
  if (days === 1) return t.tomorrow;
  if (days <= 6) return formatInTimeZone(instant, timezone, "EEEE", { locale: itLocale });

  const day = Number(formatInTimeZone(instant, timezone, "d"));
  const month = formatInTimeZone(instant, timezone, "MMMM", { locale: itLocale });
  const date = `${day === 1 ? "1°" : day} ${month}`;
  return (day === 8 || day === 11 ? t.onDateElided : t.onDate).replace("{date}", date);
}
