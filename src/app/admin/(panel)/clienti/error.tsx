"use client";

import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";

// Errore di lettura nell'elenco o nella scheda di un cliente: un messaggio dell'app invece della
// pagina d'errore predefinita.
export default function CustomersError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
