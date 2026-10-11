// File iCalendar (RFC 5545) di una prenotazione per "Aggiungi al calendario" (fetta 8b). Logica
// pura: orari sempre in UTC, UID stabile indipendente dal dominio, nessun dato del cliente.

export type BookingIcsInput = {
  id: string;
  startsAt: Date | string;
  endsAt: Date | string;
  serviceName: string;
  shopName: string;
  address: string | null;
  now: Date;
  /** Parte fissa dell'UID (costante del tema): un nuovo download aggiorna l'evento, non lo duplica. */
  uidHost: string;
};

/** "20261024T080000Z". */
const utcStamp = (instant: Date | string): string =>
  new Date(instant).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");

/** Escape dei valori di testo: barra rovesciata, punto e virgola, virgola e a capo. */
const escapeText = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");

const encoder = new TextEncoder();

/** Spezza una riga a 75 ottetti senza dividere un carattere; le continuazioni iniziano con uno spazio. */
function fold(line: string): string {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildBookingIcs(input: BookingIcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Barber Shop//Prenotazioni//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.id}@${input.uidHost}`,
    `DTSTAMP:${utcStamp(input.now)}`,
    `DTSTART:${utcStamp(input.startsAt)}`,
    `DTEND:${utcStamp(input.endsAt)}`,
    `SUMMARY:${escapeText(`${input.serviceName} – ${input.shopName}`)}`,
    ...(input.address ? [`LOCATION:${escapeText(input.address)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
