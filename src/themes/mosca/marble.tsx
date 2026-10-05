// Marmo nero della testata: fondo --surface-marble con venature chiare in SVG (linee curve sottili,
// opacità 0.2–0.5, spessori diversi). Solo in testata (docs/DESIGN.md).

const VEINS: Array<{ d: string; width: number; opacity: number }> = [
  { d: "M -20 40 C 60 70 110 20 180 60 S 300 150 420 120", width: 1.6, opacity: 0.45 },
  { d: "M 60 -10 C 90 60 70 120 140 170 S 230 260 260 320", width: 0.8, opacity: 0.3 },
  { d: "M 140 170 C 190 160 230 200 300 190 S 380 210 420 250", width: 0.5, opacity: 0.25 },
  { d: "M -20 210 C 40 190 90 230 150 220 S 230 180 260 140", width: 2.2, opacity: 0.2 },
  { d: "M 180 60 C 200 90 240 95 260 130", width: 0.6, opacity: 0.4 },
  { d: "M 300 -10 C 290 40 320 80 300 130 S 330 230 360 320", width: 1.1, opacity: 0.35 },
  { d: "M 20 300 C 60 260 120 280 170 250", width: 0.7, opacity: 0.3 },
  { d: "M 230 220 C 250 240 245 270 275 300", width: 0.4, opacity: 0.5 },
];

export function Marble() {
  return (
    <svg
      viewBox="0 0 400 300"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 h-full w-full"
      fill="none"
      stroke="var(--marble-vein)"
      strokeLinecap="round"
    >
      {VEINS.map((vein) => (
        <path
          key={vein.d}
          d={vein.d}
          strokeWidth={vein.width}
          strokeOpacity={vein.opacity}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
