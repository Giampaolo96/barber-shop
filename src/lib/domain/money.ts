// Importi in centesimi interi (CLAUDE.md regola 3): conversione solo su stringhe, mai float.

/** Massimo di un integer Postgres (`price_cents`). */
const MAX_CENTS = 2_147_483_647;

/** Virgola o punto come separatore decimale, al massimo 2 decimali, niente migliaia né segno. */
const EURO_PATTERN = /^(\d+)(?:[.,](\d{1,2}))?$/;

/** Euro scritti dall'utente ("12,50") → centesimi (1250); `null` se l'input non è valido. */
export function parseEuroToCents(input: string): number | null {
  const match = EURO_PATTERN.exec(input.trim());
  if (!match) return null;

  const [, euros, decimals = ""] = match;
  // Oltre 9 cifre intere si supera comunque il massimo: evita numeri non sicuri.
  if (euros.replace(/^0+/, "").length > 9) return null;

  const cents = Number(euros) * 100 + Number(decimals.padEnd(2, "0"));
  return cents <= MAX_CENTS ? cents : null;
}

/** Intero con il punto delle migliaia it-IT ("1.234"), anche sotto i 10.000. */
export function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Centesimi → "1.234,50 €" (formato it-IT, sempre due decimali). */
export function formatCents(cents: number): string {
  const euros = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `${groupThousands(euros)},${rest} €`;
}

/** Centesimi → valore del campo prezzo ("12,50"), senza simbolo né migliaia. */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}
