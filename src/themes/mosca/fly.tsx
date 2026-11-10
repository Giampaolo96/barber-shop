// La mosca del tema: icona a tratto, testa e corpo pieni, due ali ellittiche, zampette sottili.
// Componente unico; il colore è currentColor. Decorativa: nascosta alle tecnologie assistive.

export function Fly({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      data-testid="fly"
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    >
      {/* ali */}
      <ellipse cx="21" cy="27" rx="7.5" ry="14" transform="rotate(-32 21 27)" strokeWidth="1.6" />
      <ellipse cx="43" cy="27" rx="7.5" ry="14" transform="rotate(32 43 27)" strokeWidth="1.6" />
      {/* zampette */}
      <path d="M27 31 L18 29 L13 24 M26 36 L16 38 L11 42 M27 41 L20 47 L18 53" strokeWidth="1" />
      <path d="M37 31 L46 29 L51 24 M38 36 L48 38 L53 42 M37 41 L44 47 L46 53" strokeWidth="1" />
      {/* testa e corpo */}
      <circle cx="32" cy="18" r="5" fill="currentColor" stroke="none" />
      <ellipse cx="32" cy="36" rx="7" ry="12" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Percorso del volo in home: un solo giro, nelle coordinate di un riquadro 320×120. Il titolo sale
 * fino a y 80 (-mt-10): la scia parte sopra, senza attraversare la prima lettera (fetta 8k).
 */
const FLIGHT_PATH =
  "M 8 66 C 60 70 96 36 150 34 C 204 32 214 92 176 96 C 138 100 140 30 206 22 C 250 17 282 30 300 44";

/**
 * Scia tratteggiata che si disegna una volta: il tratteggio resta quello della scia, una maschera a
 * tratto pieno (pathLength 1) la scopre da un capo all'altro. Senza movimento è già tutta visibile.
 */
function Trail({
  id,
  d,
  strokeOpacity,
  timing,
}: {
  id: string;
  d: string;
  strokeOpacity: number;
  /** Stessi tempi del volo che accompagna. */
  timing: "is-flight" | "is-landing";
}) {
  return (
    <>
      <mask id={id} maskUnits="userSpaceOnUse">
        <path d={d} pathLength={1} className={`fly-trail-reveal ${timing}`} fill="none" stroke="white" strokeWidth="6" />
      </mask>
      <path
        d={d}
        mask={`url(#${id})`}
        fill="none"
        stroke="var(--marble-vein)"
        strokeOpacity={strokeOpacity}
        strokeWidth="1"
        strokeDasharray="3 5"
      />
    </>
  );
}

/**
 * Mosca in volo sopra il nome del negozio, con la scia tratteggiata di un giro che si disegna mentre
 * vola. L'animazione parte una volta al caricamento e solo senza prefers-reduced-motion; altrimenti
 * la mosca è già posata e la scia completa.
 */
export function FlyFlight() {
  return (
    <div className="relative h-[120px] w-[320px] max-w-full" aria-hidden="true">
      <svg viewBox="0 0 320 120" className="absolute inset-0 h-full w-full overflow-visible">
        <Trail id="fly-flight-trail" d={FLIGHT_PATH} strokeOpacity={0.55} timing="is-flight" />
      </svg>
      <Fly
        className="fly-flight mark-glow absolute top-0 left-0 size-8 text-on-marble"
        style={{ offsetPath: `path("${FLIGHT_PATH}")`, offsetRotate: "auto 90deg" }}
      />
    </div>
  );
}

/** Percorso della schermata di conferma: una scia che scende e si chiude dove la mosca si posa. */
const LANDING_PATH = "M 6 22 C 60 4 110 70 160 52 C 205 36 196 8 170 14 C 140 22 170 78 236 84";

/**
 * Scia della conferma che termina con la mosca posata: la mosca percorre la scia e atterra a fine
 * percorso (una volta sola); senza movimento è già posata.
 */
export function FlyLanding() {
  return (
    <div className="relative h-[100px] w-[260px] max-w-full" aria-hidden="true">
      <svg viewBox="0 0 260 100" className="absolute inset-0 h-full w-full overflow-visible">
        <Trail id="fly-landing-trail" d={LANDING_PATH} strokeOpacity={0.6} timing="is-landing" />
      </svg>
      <Fly
        className="fly-landing mark-glow absolute top-0 left-0 size-9 text-on-marble"
        style={{ offsetPath: `path("${LANDING_PATH}")`, offsetRotate: "0deg" }}
      />
    </div>
  );
}

/** Mosca piccola e ferma: listino e stati vuoti dell'area clienti. */
export function FlySmall({ className }: { className?: string }) {
  return <Fly className={className ?? "size-6"} />;
}

/** Mosca dentro lo slot toccato mentre si apre il riepilogo; due battiti d'ali, solo se il movimento è ammesso. */
export function FlyPending({ className }: { className?: string }) {
  return <Fly className={`fly-pending ${className ?? ""}`} />;
}
