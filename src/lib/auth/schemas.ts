import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

const email = z.string().trim().max(254).pipe(z.email());

/** Telefono normalizzato in E.164, con l'Italia come paese predefinito. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+\d][\d\s()./-]*$/)
  .transform((value, ctx) => {
    const parsed = parsePhoneNumberFromString(value, "IT");
    if (!parsed?.isValid()) {
      ctx.addIssue({ code: "custom", message: "invalid phone number" });
      return z.NEVER;
    }
    return String(parsed.number);
  });

// `next` troppo lungo o non valido si scarta (ritorno alla home): non deve far fallire il login.
export const emailLoginSchema = z.object({
  email,
  next: z.string().max(2048).optional().catch(undefined),
});

// Codice a 6 cifre dell'email (fetta 8): l'email si normalizza come la normalizza il database
// per il limite dei tentativi; gli spazi incollati nel codice (es. "123 456") si tolgono.
export const loginCodeSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  token: z.string().transform((value) => value.replace(/\s+/g, "")).pipe(z.string().regex(/^\d{6}$/)),
  next: z.string().max(2048).optional().catch(undefined),
});

// La password non si tocca e non si valida oltre il "non vuota": la lunghezza minima vale
// per le password nuove e il modulo di login non deve rivelare la policy.
export const staffLoginSchema = z.object({
  email,
  password: z.string().min(1),
});

// Solo i campi scelti dal cliente: timestamp dei consensi, ruolo e blocco non arrivano
// mai dal client (le chiavi sconosciute vengono scartate).
export const completeProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  phone: phoneSchema,
  privacyConsent: z.literal(true),
  marketingConsent: z.boolean().default(false),
});

/** Tipi di link email ammessi: magic link e conferma del primo accesso. */
export const EMAIL_LINK_TYPES = ["email", "magiclink", "signup"] as const;

export const emailLinkSchema = z.object({
  tokenHash: z.string().min(1).max(512),
  type: z.enum(EMAIL_LINK_TYPES),
  // Percorso relativo, oppure l'URL di redirect con la destinazione codificata (più lungo).
  next: z.string().max(4096).nullish(),
});
