// Schemi Zod delle server action dell'area admin (SPEC §3.1–3.5, §6.4–6.8). I dati arrivano da
// FormData: numeri come stringhe, checkbox già convertite in booleani dalla server action.
// Le chiavi non previste vengono scartate (id, profile_id, prezzi già in centesimi, ruoli).
import { z } from "zod";
import { isValidLocalDate, isValidLocalTime } from "@/lib/domain/local-time";
import { SETTINGS_LIMITS, SLOT_GRANULARITY_OPTIONS } from "@/lib/domain/settings";
import { parseEuroToCents } from "./money";

export { SETTINGS_LIMITS, SLOT_GRANULARITY_OPTIONS };

const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** Testo facoltativo: vuoto o di soli spazi diventa `null`. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const isHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
};

/** URL https:// facoltativo (il logo è mostrato ai clienti). */
const optionalHttpsUrl = optionalText(2048).refine((value) => value === null || isHttpsUrl(value));

/** Intero non negativo scritto in un campo del form. */
const intString = z
  .string()
  .trim()
  .regex(/^\d{1,9}$/)
  .transform(Number);

const isValidTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

// Servizi -----------------------------------------------------------------------

export const serviceSchema = z.object({
  name: requiredText(100),
  description: optionalText(500),
  durationMin: intString.pipe(z.number().int().min(1).max(480)),
  price: z.string().transform((value, ctx) => {
    const cents = parseEuroToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "invalid price" });
      return z.NEVER;
    }
    return cents;
  }),
  isActive: z.boolean(),
}).transform(({ price, ...service }) => ({ ...service, priceCents: price }));

// Barbieri ----------------------------------------------------------------------

export const barberSchema = z.object({
  displayName: requiredText(100),
  bio: optionalText(500),
  isActive: z.boolean(),
  serviceIds: z.array(z.uuid()),
});

// Orari settimanali ---------------------------------------------------------------

const localTime = z.string().refine(isValidLocalTime);

const weekday = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().min(1).max(7));

/** Elenco piatto di fasce, lo stesso formato di `set_working_hours`. */
export const weeklyHoursSchema = z
  .array(z.object({ weekday, start: localTime, end: localTime }))
  .superRefine((slots, ctx) => {
    slots.forEach((slot, index) => {
      if (slot.start >= slot.end) {
        ctx.addIssue({ code: "custom", message: "start must precede end", path: [index] });
      }
    });
    // Intervalli [inizio, fine): fasce contigue ammesse, sovrapposte no.
    const sorted = [...slots].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous.weekday === current.weekday && current.start < previous.end) {
        ctx.addIssue({ code: "custom", message: "overlap" });
        return;
      }
    }
  });

export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

// Assenze e chiusure ----------------------------------------------------------------

const localDate = z.string().refine(isValidLocalDate);

const localDateTime = z.string().refine((value) => {
  const [date, time, extra] = value.split("T");
  return extra === undefined && isValidLocalDate(date) && time !== undefined && isValidLocalTime(time);
});

/** Periodo in ora locale del negozio: la conversione in UTC la fa la server action. */
const periodSchema = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal("allDay"),
      fromDate: localDate,
      toDate: localDate,
      reason: optionalText(200),
    }),
    z.object({
      mode: z.literal("timed"),
      start: localDateTime,
      end: localDateTime,
      reason: optionalText(200),
    }),
  ])
  .refine((period) =>
    period.mode === "allDay" ? period.fromDate <= period.toDate : period.start < period.end,
  );

export type Period = z.infer<typeof periodSchema>;

export const timeOffSchema = periodSchema;
export const closureSchema = periodSchema;

// Impostazioni --------------------------------------------------------------------

export const settingsSchema = z.object({
  name: requiredText(100),
  address: optionalText(200),
  phone: optionalText(50),
  logoUrl: optionalHttpsUrl,
  timezone: z.string().trim().min(1).refine(isValidTimeZone),
  slotGranularityMin: intString.pipe(
    z.number().refine((value) => (SLOT_GRANULARITY_OPTIONS as readonly number[]).includes(value)),
  ),
  minAdvanceMin: intString.pipe(z.number().max(SETTINGS_LIMITS.minAdvanceMin)),
  maxHorizonDays: intString.pipe(z.number().min(1).max(SETTINGS_LIMITS.maxHorizonDays)),
  cancelLimitMin: intString.pipe(z.number().max(SETTINGS_LIMITS.cancelLimitMin)),
  bufferMin: intString.pipe(z.number().max(SETTINGS_LIMITS.bufferMin)),
  noShowBlockThreshold: intString.pipe(z.number().max(SETTINGS_LIMITS.noShowBlockThreshold)),
  privacyPolicyVersion: requiredText(50),
});

/**
 * Impostazioni salvabili dal modulo: la versione dell'informativa è in sola lettura finché non c'è
 * il flusso di nuovo consenso (fetta 9). Cambiarla oggi impedirebbe a tutti i clienti di prenotare
 * (create_online_booking richiede il consenso alla versione corrente) senza poterlo rinnovare.
 */
export const editableSettingsSchema = settingsSchema.omit({ privacyPolicyVersion: true });

// Account staff -------------------------------------------------------------------

/** Account creato dall'admin: sempre un barbiere, il ruolo non arriva dal client. */
export const staffAccountSchema = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  // La password non si tocca: spazi compresi. 72 è il limite di bcrypt.
  password: z.string().min(10).max(72),
  displayName: requiredText(100),
  barberId: z.uuid(),
});

export const staffBlockSchema = z.object({
  profileId: z.uuid(),
  blocked: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const staffLinkSchema = z.object({
  barberId: z.uuid(),
  profileId: z.uuid(),
});

export const barberIdSchema = z.object({ barberId: z.uuid() });

// Ritratto del barbiere (fetta 8d). Il browser lo manda già ridotto a 512×512 in WebP o, dove
// il canvas non sa produrre WebP (Safari iOS), in JPEG. Il tipo si controlla prima del peso.
export const PORTRAIT_MAX_BYTES = 1024 * 1024;
export const PORTRAIT_UPLOAD_TYPES = ["image/webp", "image/jpeg"] as const;

export const barberPhotoSchema = z.object({
  barberId: z.uuid(),
  photo: z
    .instanceof(File)
    .refine((file) => (PORTRAIT_UPLOAD_TYPES as readonly string[]).includes(file.type) && file.size > 0),
});

// Identificatori e azioni di riga --------------------------------------------------

export const idSchema = z.object({ id: z.uuid() });

/** Id facoltativo: assente in creazione, uuid in modifica. */
export const optionalIdSchema = z.object({ id: z.uuid().nullish() });

export const moveSchema = z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) });


/** Parametro di rotta: un uuid valido, altrimenti la pagina risponde 404. */
export const isUuid = (value: string): boolean => z.uuid().safeParse(value).success;
