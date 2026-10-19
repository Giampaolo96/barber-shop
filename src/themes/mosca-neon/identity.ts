// Identità dell'app installata (manifest, barra del browser, pagina offline): i colori del tema
// "Mosca neon", fondo nero profondo. Il disegno dell'icona è quello di Mosca (già su marmo scuro).

export const appIdentity = {
  /** Barra del browser e della finestra dell'app: il fondo delle pagine. */
  themeColor: "#0b0b0c",
  /** Schermata di avvio su Android. */
  backgroundColor: "#0b0b0c",
} as const;

/** Controlli nativi scuri; su iOS barra di stato nera con testo chiaro, sopra la pagina. */
export const appAppearance = {
  colorScheme: "dark",
  statusBarStyle: "black",
} as const;
