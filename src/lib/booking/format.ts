// Formattazione di date e orari per il cliente, sempre nella timezone del negozio (CLAUDE.md regola 2).
import { it as itLocale } from "date-fns/locale/it";
import { formatInTimeZone } from "date-fns-tz";
import { it } from "@/i18n/it";

/** "HH:mm" locale del negozio. */
export const formatTime = (instant: Date | string, tz: string): string =>
  formatInTimeZone(new Date(instant), tz, "HH:mm");

/** "lunedì 12 ottobre, 10:30". */
export const formatDateTime = (instant: Date | string, tz: string): string =>
  formatInTimeZone(new Date(instant), tz, "EEEE d MMMM, HH:mm", { locale: itLocale });

/** "martedì 13 ottobre": giorno locale del negozio, senza ora. */
export const formatLongDate = (instant: Date | string, tz: string): string =>
  formatInTimeZone(new Date(instant), tz, "EEEE d MMMM", { locale: itLocale });

/** Etichetta di un giorno locale `YYYY-MM-DD` nella striscia dei giorni: "lun 12 ott". */
export const formatDayLabel = (date: string): string =>
  formatInTimeZone(new Date(`${date}T12:00:00Z`), "UTC", "EEE d MMM", { locale: itLocale });

/** Parti di un giorno locale `YYYY-MM-DD` per le caselle dei giorni: "lun", "12", "ott". */
export const dayParts = (date: string): { weekday: string; day: string; month: string } => {
  const noon = new Date(`${date}T12:00:00Z`);
  const part = (pattern: string) => formatInTimeZone(noon, "UTC", pattern, { locale: itLocale });
  return { weekday: part("EEE"), day: part("d"), month: part("MMM") };
};

/** Link `tel:` dal telefono del negozio (solo cifre e +); null se manca. */
export const telHref = (phone: string | null): string | null =>
  phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;

/** Prima riga non vuota della bio del barbiere, usata come specialità; null se non c'è. */
export const firstBioLine = (bio: string | null): string | null =>
  bio?.split(/\r\n|\r|\n/).map((line) => line.trim()).find((line) => line !== "") ?? null;

/** Durata di un servizio: "30 min". */
export const formatDuration = (minutes: number): string => it.booking.duration.replace("{count}", String(minutes));
