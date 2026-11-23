// Testo dell'informativa privacy (fetta 9b): un solo punto da sostituire con il testo del titolare.
// Prima dell'apertura ai clienti, e prima di ogni cambio di versione in Impostazioni, aggiornare
// questo testo (docs/GO-LIVE.md §5). Non va in src/i18n/it.ts, che contiene le etichette dell'interfaccia.

export function PrivacyPolicyText() {
  return (
    <div className="flex flex-col gap-4 text-base leading-relaxed">
      <p className="border border-ink p-4 font-medium">
        Testo in preparazione: l&apos;informativa completa del negozio sarà pubblicata qui prima
        dell&apos;apertura delle prenotazioni.
      </p>
    </div>
  );
}
