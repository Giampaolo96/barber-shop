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

/** Percorso del volo in home: un solo giro, nelle coordinate di un riquadro 320×120. */
const FLIGHT_PATH =
  "M 8 104 C 70 108 96 36 150 34 C 204 32 214 92 176 96 C 138 100 140 30 206 22 C 250 17 282 30 300 44";

/**
 * Mosca in volo sopra il nome del negozio, con la scia tratteggiata di un giro. L'animazione parte
 * una volta al caricamento e solo senza prefers-reduced-motion; altrimenti la mosca è già posata.
 */
export function FlyFlight() {
  return (
    <div className="relative h-[120px] w-[320px] max-w-full" aria-hidden="true">
      <svg viewBox="0 0 320 120" className="absolute inset-0 h-full w-full overflow-visible">
        <path
          d={FLIGHT_PATH}
          fill="none"
          stroke="var(--marble-vein)"
          strokeOpacity="0.55"
          strokeWidth="1"
          strokeDasharray="3 5"
        />
      </svg>
      <Fly
        className="fly-flight absolute top-0 left-0 size-8 text-on-marble"
        style={{ offsetPath: `path("${FLIGHT_PATH}")`, offsetRotate: "auto 90deg" }}
      />
    </div>
  );
}

/** Mosca dentro lo slot toccato mentre si apre il riepilogo; batte le ali solo se il movimento è ammesso. */
export function FlyPending({ className }: { className?: string }) {
  return <Fly className={`fly-pending ${className ?? ""}`} />;
}
