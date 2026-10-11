"use client";

import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";

// Errore fuori dal caricamento dei dati (es. impostazioni del negozio non leggibili): un messaggio
// dell'app invece della pagina d'errore predefinita.
export default function StatsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">
        {it.admin.stats.error}
      </p>
      <Button type="button" variant="outline" onClick={reset} className="self-start">
        {it.admin.calendar.retry}
      </Button>
    </div>
  );
}
