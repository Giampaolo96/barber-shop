# Avanzamento

| Fetta | Stato | Data | Note |
|---|---|---|---|
| 0 | completata | 2026-10-02 | Vedi "Fetta 0" sotto |
| 1 | completata | 2026-10-02 | Vedi "Fetta 1" sotto |
| 2 | da fare | | |
| 3 | da fare | | |
| 4 | da fare | | |
| 5 | da fare | | |
| 6 | da fare | | |
| 7 | da fare | | |
| 8 | da fare | | |
| 9 | da fare | | |

## Decisioni
(il lead aggiunge qui le decisioni prese durante le fette)

## Fetta 0 – Setup progetto, CI, Supabase locale, deploy di prova

**Stato**: completata. CI verde su GitHub e deploy Vercel attivo su https://barber-shop-jade-alpha.vercel.app/ (entrambi confermati dall'utente il 2026-10-02).

**Fatto**
- Next.js 16 (App Router), TypeScript strict, Tailwind 4, ESLint flat config, shadcn/ui inizializzato (stile radix-nova, nessun componente).
- Pagina segnaposto in `src/app/(customer)/page.tsx`, testi in `src/i18n/it.ts`, `<html lang="it">`.
- Script `lint`, `typecheck`, `test` (Vitest), `test:e2e` (Playwright, Chromium con viewport mobile).
- Supabase locale: `supabase/config.toml`, `supabase/seed.sql` vuoto, nessuna migrazione.
- `.env.example`, `.github/workflows/ci.yml`, `docs/DEPLOY.md`.
- Test: `tests/acceptance/setup.test.ts` (50 casi), `tests/e2e/smoke.spec.ts` (4 casi).

**Esiti**: lint ok, typecheck ok, Vitest 50/50, Playwright 4/4 (dev e build di produzione), `npx supabase start` ok. Review: nessun bloccante.

**Decisioni**
- Node 24: `.nvmrc` = `24`, `engines.node` = `>=24 <25`; `package-lock.json` committato.
- Branch principale `main`; la CI parte su push e pull request verso `main`.
- In CI Playwright gira sulla build di produzione (webServer = build + start); in locale usa `npm run dev`.
- `.env.example` con valori vuoti; in locale si copiano da `npx supabase status`.
- Nome negozio segnaposto "Barber Shop" (SPEC §13.8 ancora aperta).
- Progetto Supabase cloud rimandato a quando serve (fetta 1 o 2).
- `AGENTS.md` nella root: lo genera Next 16; tenerlo evita che `next dev` scriva in `CLAUDE.md`.
- Font di sistema (rimosso Geist aggiunto da shadcn); `shadcn` e `tw-animate-css` in `devDependencies`.
- Config Vitest in `vitest.config.mts` (non `.ts`) per evitare un avviso di Vite.

**Da fare nelle prossime fette**
- **Dalla fetta 1 la CI deve avviare Supabase (`npx supabase start`) prima dei test**, perché i test RLS e quelli che toccano il DB ne hanno bisogno.
- **Punto aperto per la fetta 2 (Auth)**: in `supabase/config.toml` `minimum_password_length = 6` e `enable_confirmations = false` sono i default permissivi di `supabase init`; vanno riallineati alla SPEC §8 quando si introduce l'autenticazione.
- Fetta 7: aggiungere la dipendenza `resend`.

**Problemi aperti / migliorie rimandate**
- In CI la build gira due volte (step Build + webServer di Playwright).
- ~~Versioni delle action GitHub (`@v4`)~~: risolto dopo la fetta 1, action a `@v7` (runtime `node24`) e Dependabot settimanale per `github-actions`.

## Fetta 1 – Schema DB + RLS + seed dati demo

**Stato**: completata, review chiusa. CI verde su GitHub con Supabase (avvio stack, test pgTAP, controllo dei tipi), confermata dall'utente il 2026-10-02.

**Fatto**
- 8 migrazioni in `supabase/migrations/`: enum ed estensione `btree_gist`, `profiles` con helper e trigger di registrazione, `shop_settings`, catalogo, orari/assenze/chiusure, `bookings` con vincolo di esclusione e trigger, `search_customers`, policy RLS e grant.
- `supabase/seed.sql`: impostazioni, 4 servizi, 3 barbieri, orari a due fasce, un'assenza, una chiusura, 3 utenti demo (`admin@demo.local`, `barber@demo.local`, `cliente@demo.local`, password `demo1234`), 4 prenotazioni.
- `src/lib/db/types.ts` generato; script `test:db` e `db:types` (genera e formatta con `oxfmt`, nuova devDependency).
- CI: `supabase start -x ...` e `npm run test:db` prima dei test.
- `docs/adr/001-rls-e-scritture-prenotazioni.md`; SPEC §2 aggiornata (admin barbiere senza flag `is_barber`).
- Test: pgTAP in `supabase/tests/` (01–07 di accettazione, 465 asserzioni; 08 regressioni della review, 10; 09 rafforzamento sicurezza, 87), `tests/acceptance/schema.test.ts` (40).

**Esiti**: lint ok, typecheck ok, Vitest 90/90, pgTAP 562/562, Playwright 4/4.

**Review**: 2 bloccanti corretti, con test di regressione in `08_review_fixes.test.sql`.
- Il trigger annullava l'`on delete set null` di `status_changed_by`: un account che aveva creato o cambiato di stato una prenotazione non era eliminabile.
- Le regole di stato non valevano in insert: ora il barbiere inserisce solo `confirmed`, `completed`/`no_show` nel futuro sono rifiutati anche in insert e allo spostamento, e una prenotazione inserita già `no_show` incrementa il contatore.

**Decisioni** (dettaglio nell'ADR 001)
- Il cliente ha solo `select` sulle proprie prenotazioni; creazione e cancellazione online arrivano nella fetta 5 con funzioni `security definer`.
- Buffer copiato sulla prenotazione; esclusione su `tstzrange(starts_at, blocked_until, '[)')`; `ends_at` e `blocked_until` sempre calcolati dal trigger.
- Durata e prezzo si ricopiano al cambio di servizio; l'admin può modificarli a mano, il barbiere no. Il buffer resta quello della creazione.
- Barbiere: da `confirmed` solo a `completed`, `no_show`, `cancelled_by_shop`; vede solo i profili dei propri clienti; ricerca con `search_customers`. Admin: qualsiasi transizione.
- `no_show_count` cambia solo tramite i trigger delle prenotazioni; `is_blocked` è solo il blocco manuale dell'admin. Il blocco automatico per no-show si calcola dal contatore al momento della prenotazione (fetta 5).
- `phone` nullable nel DB; il trigger di registrazione crea il profilo con il solo id.
- `barbers.profile_id` `on delete set null`.
- Supabase cloud rimandato alla fetta 2.

**Rafforzamento sicurezza dopo la review** (6 migrazioni `2026100213*`, test in `09_security_hardening.test.sql`)
- `bookings`: `id` e `created_at` immutabili; il barbiere può correggere nominativo e telefono dell'ospite; l'admin può modificare prezzo e durata, con ricalcolo di `ends_at` e `blocked_until`.
- `customer_id` deve puntare a un profilo `customer`.
- Contatore no-show: cambiando `customer_id` di una `no_show` il conteggio si sposta; eliminando una `no_show` scende. Solo l'admin elimina prenotazioni.
- Note staff nella tabella separata `booking_staff_notes` (RLS solo staff); `bookings.notes` resta la nota visibile al cliente.
- `barbers.profile_id` non leggibile da `anon`; `barber_services` visibili ad `anon` e `customer` solo con servizio e barbiere attivi.
- Privilegi di default chiusi nello schema `public` per le tabelle; per le funzioni revoke esplicito in ogni migrazione, verificato da un test pgTAP con elenco di eccezioni (vedi ADR 001).
- Guardia dei profili senza `pg_trigger_depth()`; protezione dell'ultimo admin; `timezone` validato.
- All'eliminazione di un profilo le prenotazioni future `confirmed` vengono cancellate.
- Via il grant di `search_customers` a `service_role`; CI con controllo dei tipi allineati; avviso nel seed; SPEC §2 e §13.4: assenze senza approvazione.

**Completamento della review** (6 migrazioni `2026100214*`, test aggiunti in `09_security_hardening.test.sql`)
- Il barbiere legge solo i profili `customer` dei propri clienti (un cliente promosso a staff non è più leggibile).
- `barbers.profile_id` leggibile solo dallo staff con `barber_accounts()`; grant di colonna su `barbers` anche per `authenticated`.
- Default privilege chiusi anche per le sequenze.
- Eliminazione di un profilo: le future `confirmed` passano a `cancelled_by_customer` se elimina l'utente stesso, a `cancelled_by_shop` se elimina l'admin.
- Timezone confrontato senza distinguere maiuscole e salvato in forma canonica; l'ultimo admin si conta escludendo i bloccati (non può essere nemmeno bloccato).
- La nota staff segue la prenotazione riassegnata (voluto, scritto nell'ADR).
- SPEC §3.6 e `CLAUDE.md` aggiornati: regola 4 su durata e prezzo, niente `select *` sulle tabelle con grant di colonna, revoke esplicito sulle funzioni.

**Review chiusa.** Due giri del reviewer: 2 bloccanti corretti nel primo, nessuno nel secondo. Il terzo commit applica le 10 migliorie del secondo giro e non viene revisionato di nuovo. Eventuali nuove migliorie non bloccanti si annotano qui sotto, senza un altro giro.

**Da fare nelle prossime fette**
- Fetta 2: nome del profilo dai metadati di registrazione, campi dei consensi, progetto Supabase cloud, riallineare `config.toml` (vedi fetta 0).
- Fetta 2 e successive: su `barbers` elencare sempre le colonne (niente `select *`); il collegamento barbiere → account si legge con `barber_accounts()`.
- Fetta 5: funzioni di prenotazione e cancellazione con SPEC §3.7.2, blocco no-show, rate limiting. I trigger di `bookings` non limitano le funzioni `security definer`: devono ricontrollare ruolo e regole.
- Fetta 9: se l'admin elimina un cliente con la `service_role` senza JWT, la server action deve prima cancellare le prenotazioni future con `cancelled_by_shop` (il database, senza utente identificato, userebbe `cancelled_by_customer`).
- Ogni migrazione che crea una funzione deve fare il `revoke` esplicito da `public`, `anon` e `authenticated`: se manca, fallisce il test in `09_security_hardening.test.sql`.

**Migliorie rimandate**
- `working_hours` non rappresenta una fascia che termina a mezzanotte.
- Tipi TypeScript: i campi calcolati dal trigger risultano obbligatori in insert.
- Il cliente legge `status_changed_by` (UUID dello staff) sulle proprie prenotazioni.
- La protezione dell'ultimo admin non gestisce due declassamenti concorrenti.
- Un barbiere che conosce l'UUID di un cliente può intestargli una prenotazione manuale e leggerne il profilo (gli UUID arrivano solo da `search_customers`).
- I default privilege del ruolo `supabase_admin` nello schema `public` restano aperti (solo per oggetti creati fuori dalle migrazioni).
- I test su ultimo admin e timezone in `09` dipendono dal seed (`shop_settings`, admin demo): vanno eseguiti dopo `db reset`.
