import type { ReactNode } from "react";

// Si rimonta a ogni cambio di pagina dell'area clienti: la classe page-in dà la dissolvenza
// d'ingresso del tema (solo opacity, solo se il movimento è ammesso; senza effetto in un tema senza luce).
// Il contenitore continua la colonna flessibile del body: "Quando?" resta alto quanto lo schermo.
export default function CustomerTemplate({ children }: { children: ReactNode }) {
  return <div className="page-in flex min-h-0 flex-1 flex-col">{children}</div>;
}
