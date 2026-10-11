// Tema "Mosca": cosa offre all'interfaccia. Ogni tema esporta gli stessi nomi (docs/DESIGN.md).
export { fontVariables } from "./fonts";
export { Marble as HeroBackground } from "./marble";
export {
  FlyFlight as HeroMark,
  FlyLanding as ConfirmationMark,
  FlyPending as PendingMark,
  FlySmall as EmptyMark,
} from "./fly";
export { Marble as ConfirmationBackground } from "./marble";
export { appIdentity, calendarUidHost } from "./identity";
export { appIconSvg } from "./app-icon";
