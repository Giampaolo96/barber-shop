// Tema "Mosca neon": cosa offre all'interfaccia, con gli stessi nomi di ogni tema (docs/DESIGN.md).
// Estende "mosca" (l'unica dipendenza ammessa tra temi): ne riusa font, marmo, mosca e icona, e ne
// carica le animazioni prima dei propri valori, che hanno la precedenza.
import "../mosca/theme.css";
import "./theme.css";

/** Cartella del tema: la pagina offline statica legge alla build il suo theme.css (src/app/offline/route.ts). */
export const themeName = "mosca-neon";

export {
  ConfirmationBackground,
  ConfirmationMark,
  EmptyMark,
  HeroBackground,
  HeroMark,
  PendingMark,
  appIconSvg,
  calendarUidHost,
} from "../mosca";
export { fontVariables } from "./fonts";
export { appAppearance, appIdentity } from "./identity";
export { Ambient as AmbientBackground } from "./ambient";
