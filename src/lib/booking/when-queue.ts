// Coda delle richieste dei giorni di "Quando?" (SPEC §5.2, fetta 8f): funzione pura. La coda è la
// finestra stessa (`wanted`, in ordine di priorità), quindi un giorno uscito dalla finestra prima di
// partire non parte più; uno scorrimento veloce su molti giorni non lancia decine di richieste.

/** Giorni da far partire ora: nell'ordine di `wanted`, senza doppioni, entro il limite di richieste contemporanee. */
export function nextRequests({
  wanted,
  inFlight,
  cached,
  limit,
}: {
  wanted: string[];
  inFlight: string[];
  cached: string[];
  limit: number;
}): string[] {
  const free = Math.max(0, limit - inFlight.length);
  const skip = new Set([...inFlight, ...cached]);
  const start: string[] = [];
  for (const date of wanted) {
    if (start.length >= free) break;
    if (skip.has(date)) continue;
    skip.add(date);
    start.push(date);
  }
  return start;
}
