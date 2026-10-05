// Schemi Zod della sezione Clienti (SPEC §6.7, decisioni fetta 6b).
import { z } from "zod";

export const CUSTOMERS_PAGE_SIZE = 25;
const MAX_QUERY = 100;

/** Parametri dell'elenco: q oltre 100 caratteri viene troncato, una pagina non valida è la 1. */
export const customerListQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((value) => (value ?? "").trim().slice(0, MAX_QUERY)),
  pagina: z
    .string()
    .optional()
    .transform((value) => (value && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : 1)),
}).transform(({ q, pagina }) => ({ q, page: pagina }));

export const customerIdSchema = z.uuid();

export const setCustomerBlockedSchema = z.object({
  customerId: customerIdSchema,
  blocked: z.enum(["true", "false"]).transform((value) => value === "true"),
});
