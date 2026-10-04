// Formattazione di date e orari per il cliente, sempre nella timezone del negozio (CLAUDE.md regola 2).
import { it as itLocale } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";

/** "HH:mm" locale del negozio. */
export const formatTime = (instant: Date | string, tz: string): string =>
  formatInTimeZone(new Date(instant), tz, "HH:mm");

/** "lunedì 12 ottobre, 10:30". */
export const formatDateTime = (instant: Date | string, tz: string): string =>
  formatInTimeZone(new Date(instant), tz, "EEEE d MMMM, HH:mm", { locale: itLocale });

/** Etichetta di un giorno locale `YYYY-MM-DD` nella striscia dei giorni: "lun 12 ott". */
export const formatDayLabel = (date: string): string =>
  formatInTimeZone(new Date(`${date}T12:00:00Z`), "UTC", "EEE d MMM", { locale: itLocale });
