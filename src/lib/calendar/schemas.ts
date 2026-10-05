// Schemi Zod delle server action del calendario (SPEC §3.6, §6.2, §6.3). I dati arrivano da
// FormData; le chiavi non previste si scartano: dal modulo non passano nota del cliente, stato,
// source, né (nelle manuali) prezzo e durata, che copia il database.
import { z } from "zod";
import { phoneSchema } from "@/lib/auth/schemas";
import { parseEuroToCents } from "@/lib/domain/money";
import { isValidLocalDate } from "@/lib/domain/local-time";
import { BOOKING_STATUSES } from "./transitions";
import { WARNING_CODES } from "./warnings";

/** Limiti dei campi del calendario (decisioni fetta 6). */
export const CALENDAR_LIMITS = { guestName: 100, staffNote: 500, minDuration: 1, maxDuration: 480 };
/** Passo dell'orario nei moduli dello staff, in minuti. */
export const TIME_STEP_MIN = 5;

const date = z.string().refine(isValidLocalDate);
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .refine((value) => Number(value.slice(3)) % TIME_STEP_MIN === 0);

const optionalNote = z
  .string()
  .trim()
  .max(CALENDAR_LIMITS.staffNote)
  .nullish()
  .transform((value) => (value ? value : null));

const confirmedWarnings = z.array(z.enum(WARNING_CODES)).default([]);

const slot = { barberId: z.uuid(), serviceId: z.uuid(), date, time, confirmedWarnings };

export const manualBookingSchema = z.discriminatedUnion("customerKind", [
  z.object({
    ...slot,
    customerKind: z.literal("registered"),
    customerId: z.uuid(),
    staffNote: optionalNote,
  }),
  z.object({
    ...slot,
    customerKind: z.literal("guest"),
    guestName: z.string().trim().min(1).max(CALENDAR_LIMITS.guestName),
    guestPhone: phoneSchema,
    staffNote: optionalNote,
  }),
]);
export type ManualBookingInput = z.infer<typeof manualBookingSchema>;

export const updateBookingSchema = z
  .object({
    id: z.uuid(),
    ...slot,
    durationMin: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .pipe(z.number().int().min(CALENDAR_LIMITS.minDuration).max(CALENDAR_LIMITS.maxDuration)),
    price: z.string(),
  })
  .transform(({ price, ...rest }, ctx) => {
    const priceCents = parseEuroToCents(price);
    if (priceCents === null) {
      ctx.addIssue({ code: "custom", message: "invalid price" });
      return z.NEVER;
    }
    return { ...rest, priceCents };
  });
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

export const bookingStatusSchema = z.object({ id: z.uuid(), status: z.enum(BOOKING_STATUSES) });

export const staffNoteSchema = z.object({ bookingId: z.uuid(), note: optionalNote });

export const customerQuerySchema = z.string().trim().min(3).max(100);
