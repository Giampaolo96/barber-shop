# ADR 003 – Area admin, account staff e service role

Data: 2026-10-03 · Stato: accettata · Fetta 3

## Contesto

La fetta 3 porta in `/admin` la gestione di servizi, barbieri (servizi abilitati, orari, assenze, account), chiusure e impostazioni (SPEC §6.4–6.6, §6.8). Due operazioni non sono possibili con la sola RLS: creare un utente in Supabase Auth e revocarne le sessioni. La fetta 2 aveva lasciato aperto proprio quest'ultimo punto: allo staff bloccato i refresh token restavano validi. La SPEC non diceva cosa fare con prenotazioni già esistenti quando si disattiva o si chiude qualcosa, né come inserire periodi a giornata intera.

## Decisione

**Service role**
- `src/lib/db/admin.ts` (`server-only`, legge `SUPABASE_SERVICE_ROLE_KEY`, nessuna sessione né cookie) è importato solo da `src/lib/admin/staff-accounts.ts`; lo verifica un test statico. Ogni azione chiama `requireRole(["admin"])` prima di qualsiasi accesso ai dati.
- Il service role serve solo a `auth.admin.createUser` e a `revoke_user_sessions`. Ruolo, nome e collegamento alla scheda si scrivono con il client dell'admin, quindi valgono RLS e trigger di guardia.
- In CI la chiave locale si ricava da `supabase status -o env` (`SERVICE_ROLE_KEY`) ed è mascherata nei log; non è mai scritta nel workflow.

**Account staff**
- L'admin crea l'account di un barbiere con email e password iniziale (almeno 10 caratteri), confermato subito, e la comunica di persona. Il ruolo è sempre `barber`; un `role` inviato dal client si ignora.
- Email già registrata → messaggio chiaro, nessuna conversione automatica di un cliente in barbiere. Se la promozione o il collegamento falliscono, l'utente appena creato si elimina; se fallisce anche l'eliminazione, un log di errore riporta l'id dell'utente Auth orfano, da eliminare a mano.
- Si può collegare a una scheda senza account un profilo staff esistente, anche quello dell'admin (admin-barbiere, SPEC §2), oppure scollegarlo. Il controllo "scheda già collegata" passa da `barber_accounts()`: `profile_id` non è leggibile da `authenticated`, nemmeno in un `WHERE`.
- Una scheda si collega solo se è ancora libera: il trigger `barbers_guard_account_link` rifiuta (`55000`) il passaggio diretto da un account a un altro, per chiunque. Così due admin che collegano in parallelo non si sovrascrivono; il secondo vede "La scheda è stata modificata, ricarica la pagina". Per cambiare account si scollega prima.
- Blocco: `is_blocked = true` con il client dell'admin, poi `revoke_user_sessions(uuid)` (`security definer`, eseguibile solo da `service_role`) cancella sessioni e refresh token. Gli access token già emessi restano validi fino alla scadenza, ma lo staff bloccato non ha privilegi nella RLS (ADR 002). L'admin non blocca se stesso; da qui non si bloccano i clienti (SPEC §6.7, fetta 6).

**Catalogo e orari**
- Servizi e barbieri con prenotazioni non si eliminano (FK `restrict`): l'interfaccia invita a disattivarli.
- Disattivare un servizio o un barbiere non cancella nulla: l'admin vede il numero di prenotazioni `confirmed` future (`starts_at > now`).
- Gli orari si salvano tutti insieme con `set_working_hours(uuid, jsonb)` (`security invoker`, solo admin, orari `HH:MM` fra 00:00 e 23:59, atomica). L'ordine dei servizi con `reorder_services(uuid[])` (`security invoker`, solo admin), che vuole l'elenco completo e senza duplicati: l'azione "su/giù" lo rilegge al momento del clic e riprova se nel frattempo è cambiato.

**Assenze e chiusure**
- Il modulo è in ora del negozio (`shop_settings.timezone`), il database in UTC. "Dal X al Y" a giornata intera va dalle 00:00 di X alle 00:00 del giorno dopo Y, quindi Y è incluso e nei giorni del cambio d'ora la durata è di 23 o 25 ore. Nell'elenco un periodo da mezzanotte a mezzanotte si mostra come giornata intera.
- Nessuna cancellazione automatica: dopo il salvataggio si mostra il numero di prenotazioni `confirmed` il cui intervallo `[starts_at, ends_at)`, buffer escluso, si sovrappone al periodo. Per un'assenza contano quelle del barbiere, per una chiusura quelle di tutti. L'avviso compare anche al barbiere che inserisce la propria assenza.
- Gli avvisi sono al singolare con una prenotazione e al plurale con più prenotazioni. Se il conteggio non riesce, l'avviso dice che non è stato possibile verificare le prenotazioni coinvolte (mai "zero" in silenzio).
- `/admin/assenze` è una rotta staff in `decideAccess`. Il barbiere vi vede e gestisce solo le proprie assenze, sempre sulla propria scheda: nessuna scelta del barbiere nel modulo. L'admin vede le assenze di tutti i barbieri, con il nome del barbiere, prima quelle non ancora finite (dalla più vicina) e poi le passate (dalla più recente); un filtro per barbiere (`?barbiere=<id>` oppure `tutti`) parte dalla sua scheda se è anche barbiere, altrimenti da tutti. L'admin inserisce un'assenza scegliendo il barbiere (preselezionato quello del filtro) e modifica quelle di qualunque barbiere. (Modifica dopo la chiusura della fetta: prima l'admin senza scheda veniva rimandato a `/admin/barbieri`.)
- La scelta fra giornata intera e periodo con orario non è stato React: i due gruppi di campi sono sempre nel DOM e il CSS mostra quello del radio selezionato, così il modulo funziona anche prima dell'idratazione.

**Impostazioni**
- Tutti i parametri della SPEC §3.1 più la versione dell'informativa. `slot_granularity_min` è ammesso solo fra 5, 10, 15, 20, 30 e 60 (menu a tendina e vincolo nel DB). Tetti in Zod e nel DB: anticipo minimo e limite di cancellazione 0–10080 minuti (7 giorni), orizzonte 1–365 giorni, buffer 0–60 minuti, soglia no-show 0–10. La riga di `shop_settings` non si elimina dall'app: niente `delete` per `authenticated`.

## Conseguenze

- Con un SMTP proprio gli account staff dovranno passare all'invito via email, con cambio password obbligatorio al primo accesso (fetta 9). Oggi la password iniziale la sceglie l'admin.
- La creazione di un account non è transazionale fra Auth e database: in caso di errore a metà l'utente si elimina, ma se fallisse anche l'eliminazione resterebbe un utente Auth con profilo `customer` e senza scheda, segnalato da un log di errore con il suo id.
- I testi delle pagine admin sono in `src/i18n/it.ts` sotto `admin.*`; gli avvisi usano il segnaposto `{count}`, con una variante `...One` per il singolare.
- Ogni pagina di `/admin` chiama `requireRole` e valida i parametri di rotta come uuid prima di interrogare il database.
