"use client";

import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";

// Errore di lettura nel dettaglio o nella nuova prenotazione (es. impostazioni o catalogo non
// leggibili): un messaggio dell'app invece della pagina d'errore predefinita.
export default function CalendarError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">
        {it.admin.calendar.pageError}
      </p>
      <Button type="button" variant="outline" onClick={reset} className="self-start">
        {it.admin.calendar.retry}
      </Button>
    </div>
  );
}
