// Disegno dell'icona dell'app installata: la mosca come SVG autonomo, perché le icone si generano
// fuori dal CSS (next/og). Lo usano solo le route delle icone, lato server (src/lib/pwa/icons.ts):
// una funzione senza effetti collaterali, così non finisce nel codice scaricato dal browser.

/** Mosca bianca su fondo marmo scuro, centrata nella zona sicura delle icone maskable (80%). */
export function appIconSvg(): string {
  const ink = "#ffffff";
  const surface = "#171717";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" fill="${surface}"/>
<g transform="translate(14.4 14.4) scale(0.55)" fill="none" stroke="${ink}" stroke-linecap="round">
<ellipse cx="21" cy="27" rx="7.5" ry="14" transform="rotate(-32 21 27)" stroke-width="2.4"/>
<ellipse cx="43" cy="27" rx="7.5" ry="14" transform="rotate(32 43 27)" stroke-width="2.4"/>
<path d="M27 31 L18 29 L13 24 M26 36 L16 38 L11 42 M27 41 L20 47 L18 53" stroke-width="1.6"/>
<path d="M37 31 L46 29 L51 24 M38 36 L48 38 L53 42 M37 41 L44 47 L46 53" stroke-width="1.6"/>
<circle cx="32" cy="18" r="5" fill="${ink}" stroke="none"/>
<ellipse cx="32" cy="36" rx="7" ry="12" fill="${ink}" stroke="none"/>
</g>
</svg>`;
}
