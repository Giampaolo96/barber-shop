// Tema attivo: l'unico punto in cui si sceglie il tema del negozio (docs/DESIGN.md). Per un altro
// negozio si crea src/themes/<nome>/ con gli stessi export e si cambiano queste due righe.
import "./mosca/theme.css";

export { appIconSvg, appIdentity, fontVariables, HeroBackground, HeroMark, PendingMark } from "./mosca";
