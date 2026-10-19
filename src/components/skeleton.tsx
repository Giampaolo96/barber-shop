import { it } from "@/i18n/it";

// Scheletri delle pagine in caricamento (loading.tsx): blocchi fermi con i colori del disabilitato,
// nessuna animazione (docs/DESIGN.md, Movimento). Ogni scheletro ripete contenitore e altezze della
// sua pagina, così all'arrivo del contenuto nulla si sposta.

/** Segnaposto di un testo o di un controllo; misure dalla classe. */
export function Bone({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`bg-disabled ${className}`} />;
}

/** Annuncio per gli screen reader: fuori dal flusso (sr-only), non sposta nulla. */
export function LoadingStatus() {
  return (
    <p role="status" className="sr-only">
      {it.loading}
    </p>
  );
}
