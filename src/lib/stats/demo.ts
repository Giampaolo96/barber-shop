// Prenotazioni demo (SPEC §6.9): nota del cliente uguale a "Prenotazione demo", senza spazi, tab e
// a capo ai bordi e senza distinguere maiuscole e minuscole. Stessa regola di admin_booking_stats
// (`lower(btrim(notes, E' \t\r\n'))`).
export function isDemoNote(notes: string | null): boolean {
  return notes !== null && notes.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "").toLowerCase() === "prenotazione demo";
}
