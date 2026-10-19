// Tema "Mosca": cosa offre all'interfaccia. Ogni tema esporta gli stessi nomi (docs/DESIGN.md).
import "./theme.css";

/** Cartella del tema: la pagina offline statica legge alla build il suo theme.css (src/app/offline/route.ts). */
export const themeName = "mosca";

export { fontVariables } from "./fonts";
export { Marble as HeroBackground } from "./marble";
export {
  FlyFlight as HeroMark,
  FlyLanding as ConfirmationMark,
  FlyPending as PendingMark,
  FlySmall as EmptyMark,
} from "./fly";
export { Marble as ConfirmationBackground } from "./marble";
export { appAppearance, appIdentity, calendarUidHost } from "./identity";
export { appIconSvg } from "./app-icon";

/** Mosca non ha luci d'ambiente. */
export function AmbientBackground() {
  return null;
}
