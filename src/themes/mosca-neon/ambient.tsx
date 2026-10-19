"use client";

import { useEffect, useRef } from "react";

/**
 * Luci d'ambiente del tema neon: tre macchie di luce bianca già sfocate su un livello fisso dietro
 * le pagine dell'area clienti. La deriva iniziale (solo CSS, theme.css) si sospende quando la
 * pagina non è visibile. Decorative: nascoste alle tecnologie assistive.
 */
export function Ambient() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => ref.current?.toggleAttribute("data-paused", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return (
    <div ref={ref} aria-hidden="true" className="ambient">
      <span className="ambient-light" />
      <span className="ambient-light" />
      <span className="ambient-light" />
    </div>
  );
}
