// Identità dell'app installata (manifest, barra del browser): i colori del tema "Mosca". Il disegno
// dell'icona è in app-icon.ts.

export const appIdentity = {
  /** Barra del browser e della finestra dell'app: il fondo delle pagine. */
  themeColor: "#ffffff",
  /** Schermata di avvio su Android. */
  backgroundColor: "#ffffff",
} as const;

/**
 * Parte fissa dell'UID degli eventi .ics ("<id>@<host>"), usata solo dalla route del calendario:
 * non dipende dal dominio, che al go-live cambia, così un nuovo download aggiorna l'evento.
 */
export const calendarUidHost = "mosca-barber-shop";
