import Link from "next/link";
import { it } from "@/i18n/it";

const t = it.offline;

// Pagina che il service worker mostra quando manca la rete (ADR 009). Pubblica e statica: niente
// sessione né dati, perché resta salvata nella cache del browser.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="font-display text-4xl leading-tight">{t.title}</h1>
      <p className="text-sm text-muted-foreground">{t.body}</p>
      {/* Senza rete la navigazione client fallisce e Next ricarica la pagina: il worker riprova. */}
      <Link
        href="/"
        prefetch={false}
        className="inline-flex h-11 w-fit items-center border border-ink px-4 text-sm font-medium hover:bg-ink hover:text-surface"
      >
        {t.retry}
      </Link>
    </main>
  );
}
