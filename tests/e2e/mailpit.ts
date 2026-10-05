// Lettura delle email di test da Mailpit (stack Supabase locale), condivisa da e2e e warm-up.
//
// La ricerca di Mailpit restituisce i messaggi dal più recente e al massimo 50 per pagina: contare i
// risultati non funziona quando la casella di un destinatario è piena. Si confronta invece l'id
// dell'email più recente prima e dopo la richiesta: quella nuova è la più recente con un id diverso.
import type { APIRequestContext } from '@playwright/test';

export const MAILPIT_URL = 'http://127.0.0.1:54324';

export type MailpitMessage = { HTML: string; Text: string; Subject: string };

/** Id dell'email più recente arrivata a `to`; null se non ce n'è nessuna. */
export const newestEmailId = async (request: APIRequestContext, to: string): Promise<string | null> => {
  const response = await request.get(`${MAILPIT_URL}/api/v1/search`, { params: { query: `to:"${to}"`, limit: '1' } });
  if (!response.ok()) throw new Error(`Mailpit non raggiungibile su ${MAILPIT_URL}`);
  return ((await response.json()) as { messages: Array<{ ID: string }> }).messages[0]?.ID ?? null;
};

/**
 * Attende un'email per `to` più recente di `previousId` (letto con `newestEmailId` prima della
 * richiesta) e la restituisce.
 */
export const waitForNewEmail = async (
  request: APIRequestContext,
  to: string,
  previousId: string | null,
  timeoutMs = 10_000,
): Promise<MailpitMessage> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const newest = await newestEmailId(request, to);
    if (newest !== null && newest !== previousId) {
      const response = await request.get(`${MAILPIT_URL}/api/v1/message/${newest}`);
      if (!response.ok()) throw new Error(`messaggio ${newest} non leggibile da Mailpit`);
      return (await response.json()) as MailpitMessage;
    }
    if (Date.now() > deadline) throw new Error(`nessuna email arrivata a ${to}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

/** Primo link dell'email verso /auth/confirm (undefined se manca). */
export const confirmHref = (message: MailpitMessage): string | undefined =>
  [...message.HTML.matchAll(/href="([^"]+)"/g)]
    .map((match) => (match[1] ?? '').replace(/&amp;/g, '&'))
    .find((href) => href.includes('/auth/confirm?'));
