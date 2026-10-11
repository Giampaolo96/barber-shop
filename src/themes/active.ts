// Tema attivo: l'unico punto in cui si sceglie il tema del negozio (docs/DESIGN.md). Per un altro
// negozio si crea src/themes/<nome>/ con gli stessi export e si cambiano le righe con "mosca".
import "./mosca/theme.css";

/** Cartella del tema: la pagina offline statica legge alla build il suo theme.css (src/app/offline/route.ts). */
export const themeName = "mosca";

export {
  appIconSvg,
  appIdentity,
  calendarUidHost,
  ConfirmationBackground,
  ConfirmationMark,
  EmptyMark,
  fontVariables,
  HeroBackground,
  HeroMark,
  PendingMark,
} from "./mosca";
