// Regole delle impostazioni del negozio (SPEC §3.1), condivise da area admin e motore di disponibilità.

/** Passi ammessi per gli orari proposti (decisione fetta 3, vincolo anche nel DB). */
export const SLOT_GRANULARITY_OPTIONS = [5, 10, 15, 20, 30, 60] as const;

/** Tetti massimi delle impostazioni (decisione dell'utente, vincoli anche nel DB). */
export const SETTINGS_LIMITS = {
  /** 7 giorni, in minuti */
  minAdvanceMin: 10_080,
  maxHorizonDays: 365,
  /** 7 giorni, in minuti */
  cancelLimitMin: 10_080,
  bufferMin: 60,
  noShowBlockThreshold: 10,
} as const;
