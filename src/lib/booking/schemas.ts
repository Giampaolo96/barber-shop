// Input delle server action della prenotazione online (CLAUDE.md – Sicurezza: Zod lato server).
import { z } from "zod";

/** Lunghezza massima della nota del cliente (decisione fetta 5), controllata anche nel DB. */
export const NOTES_MAX_LENGTH = 500;

export const barberChoiceSchema = z.union([z.uuid(), z.literal("any")]);

export const createBookingSchema = z.object({
  serviceId: z.uuid(),
  barberId: barberChoiceSchema,
  startsAt: z.iso.datetime({ offset: true }),
  notes: z
    .string()
    .trim()
    .max(NOTES_MAX_LENGTH)
    .optional()
    .transform((value) => value || undefined),
});

export const cancelBookingSchema = z.object({ bookingId: z.uuid() });
