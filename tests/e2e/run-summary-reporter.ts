// Reporter di riepilogo degli e2e (indagine sull'e2e instabile della fetta 6c): un test non eseguito
// non deve passare inosservato. Succede, ad esempio, quando un progetto dipendente (admin-settings
// dipende da mobile-chromium) non parte perché un test del progetto da cui dipende è fallito.
// A fine giro stampa sempre "eseguiti X su N" e, se ci sono test non eseguiti senza uno skip
// esplicito (test.skip/fixme), li elenca e fa fallire il giro. Non è un file di test.

import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';

const title = (test: TestCase): string => test.titlePath().filter(Boolean).join(' › ');

export default class RunSummaryReporter implements Reporter {
  private root: Suite | null = null;

  onBegin(_config: unknown, suite: Suite): void {
    this.root = suite;
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const tests = this.root?.allTests() ?? [];
    const explicitSkip = (test: TestCase) => test.expectedStatus === 'skipped';
    const notRun = tests.filter(
      (test) => !explicitSkip(test) && (test.results.length === 0 || test.outcome() === 'skipped'),
    );
    const skipped = tests.filter(explicitSkip);
    const failed = tests.filter((test) => test.outcome() === 'unexpected');
    const flaky = tests.filter((test) => test.outcome() === 'flaky');
    const run = tests.length - notRun.length - skipped.length;

    console.log(
      `\nRiepilogo e2e: eseguiti ${run} su ${tests.length}` +
        ` (falliti ${failed.length}, instabili ${flaky.length}, saltati esplicitamente ${skipped.length},` +
        ` NON ESEGUITI ${notRun.length})`,
    );
    if (result.status === 'interrupted') return undefined;
    // Nessun test raccolto (es. il server web non è partito): non è un giro riuscito.
    if (tests.length === 0) {
      console.log('Nessun test eseguito: controlla filtri e avvio del server (il giro fallisce).');
      return { status: 'failed' };
    }
    if (notRun.length === 0) return undefined;

    console.log('Test non eseguiti senza uno skip esplicito (il giro fallisce):');
    for (const test of notRun) console.log(`  - ${title(test)}`);
    return { status: 'failed' };
  }
}
