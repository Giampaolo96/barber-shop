# Avanzamento

| Fetta | Stato | Data | Note |
|---|---|---|---|
| 0 | completata | 2026-10-02 | Vedi "Fetta 0" sotto |
| 1 | completata | 2026-10-02 | Vedi "Fetta 1" sotto |
| 2 | completata | 2026-10-02 | Vedi "Fetta 2" sotto |
| 3 | completata | 2026-10-03 | Vedi "Fetta 3" sotto |
| 4 | completata | 2026-10-04 | Vedi "Fetta 4" sotto |
| 5 | completata | 2026-10-04 | Vedi "Fetta 5" sotto |
| 6 | da fare | | |
| 7 | da fare | | |
| 8 | da fare | | |
| 9 | da fare | | |

Prerequisiti per l'uso reale (dominio, email, piani, privacy, proprietà degli account): checklist in `docs/GO-LIVE.md`, da completare con il titolare del negozio.

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

## Fetta 2 – Auth e ruoli

**Stato**: completata, review chiusa (due giri del reviewer). CI su GitHub e progetto Supabase cloud da verificare dopo il push.

**Fatto**
- Login clienti con magic link (`/accedi` → email → pagina `/auth/confirm` con pulsante "Accedi": la GET non consuma il token, la verifica avviene con la POST della server action), completamento del profilo su `/profilo/completa`, pagina `/profilo` segnaposto, header con login/logout.
- Login staff con email e password su `/admin/login`; area `/admin` con menu per ruolo e pagine segnaposto delle sezioni.
- `src/proxy.ts` (sessione e regole di accesso), `src/lib/auth/` (`decideAccess`, `safeNextPath`, schemi Zod, `getCurrentUser`/`requireRole`, server action, accesso da link email), `src/lib/db/` (client browser e server).
- 4 migrazioni `2026100215*` e `20261002160000`: `shop_settings.privacy_policy_version`, consensi su `profiles` con trigger, nome dai metadati di registrazione, staff bloccato senza privilegi.
- `supabase/config.toml` riallineato (password minima 10, conferma email, cambio password sicuro, `site_url` su `localhost`), template email in `supabase/templates/`, seed con telefoni in E.164 e cliente demo con consenso.
- CI: variabili `NEXT_PUBLIC_SUPABASE_*` ricavate da `supabase status -o env`.
- Hook `quality-gate.ps1`: guarda solo `src`, `supabase/migrations` e `supabase/seed.sql`.
- `docs/adr/002-autenticazione.md`, `docs/DEPLOY.md` (Supabase cloud, SMTP proprio, primo admin), SPEC §3.1, §5.5, §8 aggiornate.
- Test: `supabase/tests/10_auth_profiles.test.sql` (114), `11_review_fixes_fetta2.test.sql` (12), `tests/acceptance/auth.test.ts` (347), `tests/e2e/auth.spec.ts` (32).

**Esiti**: lint ok, typecheck ok, Vitest 437/437, pgTAP 688/688, build ok, Playwright 36/36.

**Review**: 2 bloccanti corretti nel primo giro, nessuno nel secondo. Le 10 migliorie del primo giro sono state applicate (la decima, riga singola di `shop_settings`, era un falso positivo: il vincolo esiste dalla fetta 1). Review chiusa: eventuali nuove migliorie non bloccanti si annotano qui sotto, senza un altro giro.
- Lo staff bloccato conservava i privilegi nel database (un admin bloccato poteva sbloccarsi): ora `is_admin()`, `is_staff()` e `current_barber_id()` ignorano un profilo bloccato; regressioni in `11_review_fixes_fetta2.test.sql`.
- Lo staff poteva entrare in `/admin` con il solo magic link: ora `/auth/confirm` apre la sessione solo ai clienti e per lo staff revoca quella creata dal link.

**Decisioni** (dettaglio nell'ADR 002)
- Magic link per i clienti, email + password per lo staff; Google e SMS rimandati.
- Ruolo solo da `profiles`, mai dai metadati del JWT; `getUser()`/`getClaims()`, mai `getSession()`.
- Profilo incompleto: blocca solo `/prenota/**`, `/prenotazioni/**`, `/profilo/**`. Lo staff su queste pagine va a `/admin`.
- Telefono in E.164 (IT predefinito) validato nell'app; nessun vincolo di formato nel database.
- Consensi: timestamp dal database, privacy valida solo per la versione corrente e non revocabile, marketing revocabile, solo l'interessato li modifica.
- Staff bloccato: "Account disabilitato" al login; a sessione aperta il proxy toglie i cookie e rimanda a `/admin/login`.
- Logout solo via POST, poi `/`.

**Correzioni ai test di accettazione** (approvate dall'utente, commit `f3bd8b5`)
- `page.route` ristretto all'host `evil.example`: la regex intercettava anche la richiesta a `/auth/confirm` con `next` esterno.
- Nuovi e2e: magic link chiesto con l'email di uno staff, staff bloccato a sessione già aperta, pagina intermedia del magic link.
- `requireRole` per lo staff bloccato rimanda a `/admin/login?motivo=disabilitato`.
- `11_review_fixes_fetta2.test.sql` è stato scritto durante l'implementazione, come regressione del bloccante sullo staff bloccato, non da `spec-qa`.

**Da fare nelle prossime fette**
- Fetta 3: account dei barbieri dall'area admin; quando l'admin blocca un account, revocare anche le sessioni lato server.
- Fetta 5: `/prenota` e `/prenotazioni` sono già trattate come pagine private da `decideAccess`.
- Fetta 9: valutare il secondo fattore TOTP per gli admin; nuovo consenso quando cambia la versione dell'informativa (`profileComplete` oggi non confronta la versione); login Google.
- Produzione: SMTP proprio (es. Resend) e progetto Supabase cloud, passi in `docs/DEPLOY.md`.

**Migliorie rimandate** (dal secondo giro della review, non applicate)
- Il matcher del proxy esclude ancora i percorsi che terminano in `.js`, `.json`, `.txt`, `.xml`, `.map`: una futura rotta come `/admin/statistiche/export.json` salterebbe il proxy. Ogni route handler futuro deve chiamare `requireRole`.
- Il token del magic link resta nell'URL di `/auth/confirm` (cronologia del browser) finché non si preme il pulsante; scade dopo un'ora e la pagina non carica risorse esterne.
- L'errore di `signOut` quando si revoca la sessione creata dal link di uno staff è ignorato (`src/lib/auth/email-link.ts`): basta un log.
- In sviluppo, durante gli e2e, il server Next scrive in console alcuni `ECONNRESET` per richieste interrotte dal browser: i test passano, ma va controllato che non compaiano in produzione.

## Fetta 3 – Admin: servizi, barbieri, orari, assenze, chiusure, impostazioni

**Stato**: completata, review chiusa (un giro, nessun bloccante; 5 migliorie applicate su richiesta dell'utente). Migrazioni applicate a Supabase cloud il 2026-10-03 (`db push`); verificato dall'utente che `revoke_user_sessions` è security definer, eseguibile solo da `service_role` e con il permesso di cancellare da `auth.sessions` e `auth.refresh_tokens`. CI verde su GitHub, confermata dall'utente il 2026-10-03.

**Fatto**
- 6 migrazioni (`2026100310*` e `2026100311*`): `set_working_hours` e `reorder_services` (invoker, solo admin), `revoke_user_sessions` (definer, solo `service_role`), vincoli di `shop_settings` (granularità 5/10/15/20/30/60, tetti massimi, niente `delete` per `authenticated`), guardia `barbers_guard_account_link`.
- `src/lib/admin/`: utilità pure (`money`, `local-time`, `periods`, `text`), schemi Zod, server action di servizi, barbieri e orari, periodi, impostazioni e account staff; `queries.ts` per le letture comuni.
- `src/lib/db/admin.ts`: client service role, importato solo da `staff-accounts.ts`.
- Pagine `/admin/servizi`, `/admin/barbieri` (scheda con servizi abilitati e account staff, orari, assenze), `/admin/chiusure`, `/admin/impostazioni`, `/admin/assenze` (le proprie assenze, nuova rotta staff in `decideAccess` e voce di menu).
- CI: `SUPABASE_SERVICE_ROLE_KEY` da `supabase status -o env`, mascherata.
- `docs/adr/003-area-admin-e-account-staff.md`; SPEC §3.1 (granularità ammesse, orizzonte minimo) e §11 (impostazioni nella fetta 3); `DEPLOY.md`.
- Test: `tests/acceptance/admin-{utils,schemas,access,staff-accounts}.test.ts`, `supabase/tests/13–15`, regressioni della review in `tests/acceptance/admin-review-fixes.test.ts` e `supabase/tests/16_review_fixes_fetta3.test.sql`, `tests/e2e/admin-*.spec.ts`, progetto Playwright `admin-settings` che parte dopo gli altri.

**Esiti**: lint ok, typecheck ok, Vitest 919/919, pgTAP 809/809, Playwright 65/65. In locale gli e2e vanno lanciati con `SUPABASE_SERVICE_ROLE_KEY` nell'ambiente (o in `.env.local`).

**Decisioni** (dettaglio nell'ADR 003)
- Servizi e barbieri con prenotazioni non si eliminano: si disattivano. Disattivazioni, assenze e chiusure non cancellano prenotazioni: mostrano solo il numero di quelle `confirmed` coinvolte (future per le disattivazioni; sovrapposte `[starts_at, ends_at)` al periodo per assenze e chiusure).
- Account staff: l'admin crea l'account (ruolo sempre `barber`) con password iniziale; email già registrata → messaggio, nessuna conversione. Collegamento di un profilo staff esistente (anche l'admin) e scollegamento. Blocco = `is_blocked` + revoca delle sessioni; gli access token già emessi restano validi fino alla scadenza ma senza privilegi nella RLS. L'admin non blocca se stesso.
- Foto e logo solo URL `https://`, mostrati con `<img>` normale.
- "Dal X al Y" a giornata intera include Y (fine alle 00:00 del giorno dopo, ora del negozio).
- `/admin/assenze`: il barbiere vede solo le proprie assenze; l'admin quelle di tutti (vedi "Modifiche dopo la chiusura").
- Limiti di sanità (non in SPEC): nomi 100, descrizione e bio 500, motivo 200, URL 2048 caratteri; durata 1–480 min; orari `HH:MM` fino a 23:59.
- Tetti delle impostazioni (utente, aggiunti a SPEC §3.1): anticipo e limite di cancellazione ≤ 7 giorni, orizzonte 1–365 giorni, buffer ≤ 60 minuti, soglia no-show 0–10.
- Avvisi al singolare e al plurale ("1 prenotazione", "N prenotazioni"); se il conteggio fallisce, avviso che non è stato possibile verificare le prenotazioni coinvolte.
- Collegamento scheda → account solo se la scheda è libera (guardia nel DB); altrimenti "La scheda è stata modificata, ricarica la pagina".
- Rollback dell'account staff: se l'eliminazione compensativa fallisce, log di errore con l'id dell'utente Auth orfano.

**Correzioni ai test di accettazione** (approvate dall'utente, commit `90471e9`)
- Due e2e (modifica di una chiusura, modifica di un'assenza del barbiere) navigavano all'elenco subito dopo il click su Salva: sotto carico l'elenco veniva reso prima del salvataggio. Ora attendono il messaggio di salvataggio.
- Avvisi al singolare e al plurale: `admin-access.test.ts` verifica entrambe le forme (chiavi `...One`) e l'e2e del barbiere con una sola prenotazione usa il testo al singolare (approvato dall'utente, nel commit della fetta).

**Da fare nelle prossime fette**
- Con l'SMTP proprio, gli account staff passeranno a invito via email con cambio password obbligatorio al primo accesso (fetta 9).
- Fetta 4: il motore legge `slot_granularity_min` (solo 5–60) e `max_horizon_days` (1–365) da `shop_settings`.
- Fetta 6: sezione Clienti (§6.7), compreso il blocco dei clienti.

**Modifiche dopo la chiusura** (richieste dall'utente, 2026-10-03)
- `/admin/assenze` per l'admin: assenze di tutti i barbieri, prima le future, filtro per barbiere che parte dalla sua scheda se è anche barbiere, inserimento con scelta del barbiere, modifica di qualunque assenza. Niente più redirect a `/admin/barbieri`. Il barbiere continua a vedere e gestire solo le proprie. SPEC §6.5 e ADR 003 aggiornati.
- Test: l'e2e "l'admin collegato a Mario…" in `admin-periods.spec.ts` è stato adeguato alla nuova vista (approvato dall'utente); logica pura (ordinamento e filtro iniziale, compreso l'admin senza scheda) in `tests/acceptance/admin-time-off-view.test.ts`.
- Modulo dei periodi: la scelta giornata intera / con orario ora funziona anche prima dell'idratazione (campi sempre nel DOM, visibilità via CSS). Sotto carico un clic arrivato prima dell'idratazione andava perso e il modulo restava sui campi sbagliati.

**Migliorie della review applicate** (su richiesta dell'utente): 1 rollback con log dell'utente orfano, 2 collegamento solo su scheda libera, 3 avviso con conteggio non verificato, 9 tetti massimi delle impostazioni, 13 avvisi al singolare e al plurale.

**Migliorie rimandate** (dalla review, non applicate: decide l'utente)
4. Periodo con orario nel buco dell'ora legale (es. 02:30 del 28/03): dopo la conversione l'inizio può superare la fine e l'utente vede un errore generico invece di "dati non validi".
5. `saveTimeOff`/`saveClosure` lanciano un'eccezione se le impostazioni non sono leggibili, invece di restituire `error`.
6. Creazione del barbiere non atomica: se fallisce l'abilitazione dei servizi la scheda resta creata e un nuovo invio crea un duplicato.
7. Se la revoca delle sessioni fallisce dopo un blocco riuscito, manca `revalidatePath` e lo stato mostrato è "errore".
8. Verifica dei privilegi su `auth.*` nel cloud da aggiungere alla checklist di `DEPLOY.md`.
10. Duplicazioni minori (`ServerClient`, codici d'errore Postgres).
11. Le azioni di riga restituiscono `error` invece di `invalid` se Zod fallisce.
12. Account staff: il messaggio d'errore di un'azione precedente resta visibile dopo un'altra riuscita.

## Fetta 4 – Motore disponibilità

**Stato**: completata, review chiusa (un giro, nessun bloccante). Migrazione applicata a Supabase cloud il 2026-10-04 (`db push`); verificato dall'utente che `availability_inputs` è security definer ed eseguibile da anon e authenticated, e che `local_band_to_interval` non è eseguibile da nessuno dei due. CI verde, confermata dall'utente il 2026-10-04.

**Fatto**
- Migrazione `20261004090000_availability_inputs.sql`:
  - `local_band_to_interval(date, time, time, tz)`: funzione interna, senza grant;
  - `availability_inputs(service, barber | null, from, to)`: `security definer`, eseguibile da anon e authenticated. Restituisce solo `kind`, `barber_id`, `starts_at` e `ends_at`.
- `src/lib/availability/` (motore puro): `computeSlotsByBarber`, `computeSlots`, `availableDays`, `pickBarber`.
- `src/lib/booking/availability.ts` (`server-only`): `getAvailableSlots` e `getAvailableDays`, con il client della richiesta e un solo caricamento dei dati per periodo.
- `docs/adr/004-motore-disponibilita.md`; SPEC §4 allineata alle decisioni (buffer, griglia, orizzonte, bilanciamento).
- Test:
  - `tests/acceptance/availability-{engine,server,db}.test.ts`;
  - `supabase/tests/17_availability_inputs.test.sql` e la regressione `18_review_fixes_fetta4.test.sql`;
  - in `09` e `10` aggiunta `availability_inputs` alle funzioni eseguibili da anon (approvato dall'utente).

**Esiti** (prima delle migliorie): lint ok, typecheck ok, Vitest 974/974, pgTAP 848/848. La fetta non ha UI.

**Decisioni** (dettaglio nell'ADR 004)
- **Niente service role** nel percorso di disponibilità: i dati arrivano da `availability_inputs`, tagliati sul periodo richiesto e sulla finestra che va da adesso alla fine dell'orizzonte.
- **Fasce di lavoro** convertite in SQL (l'ora legale la gestisce Postgres); test con date fisse 2026-10-25 e 2027-03-28.
- **Griglia** allineata all'orologio locale; con una granularità non ammessa il motore lancia un errore.
- **Buffer** solo verso le prenotazioni successive; le prenotazioni esistenti occupano fino a `blocked_until`.
- **Orizzonte** riferito all'inizio dello slot (fino alla fine del giorno locale di oggi + N); anticipo con bordo incluso.
- **`pickBarber`**: sceglie solo tra i barbieri liberi; vince chi ha meno prenotazioni non cancellate nel giorno; a parità decide un hash FNV-1a di `data:barber_id`, che ruota con la data.
- **`getAvailableDays`**: al massimo 366 giorni.
- **`date`** è sempre una data locale `YYYY-MM-DD` nella timezone del negozio.

**Da fare nelle prossime fette**
- **Fetta 5:**
  - esporre `getAvailableSlots` e `getAvailableDays` come server action o route, con rate limiting e senza `requireRole` (l'accesso anon è voluto);
  - la funzione di creazione ricontrolla in SQL fascia, assenze, chiusure, anticipo, orizzonte e allineamento alla griglia;
  - test di coerenza tra motore e validazione SQL;
  - fonte dei conteggi giornalieri per `pickBarber`.

**Migliorie della review applicate** (tutte, su richiesta dell'utente; la review è chiusa)
1. SPEC §4 allineata alle decisioni dell'ADR 004.
2. **Prenotazioni oltre il periodo:** `availability_inputs` legge le `busy` fino a `p_to` + 60 minuti (il buffer massimo). Regressione in `supabase/tests/18_review_fixes_fetta4.test.sql`.
3–4. **Modulo di dominio condiviso** `src/lib/domain/`:
   - `local-time.ts` (spostato da `src/lib/admin/`, dove resta un re-export usato dai test della fetta 3), con in più `localDateOf` e `startOfLocalDay`;
   - `settings.ts`, con `SLOT_GRANULARITY_OPTIONS` e `SETTINGS_LIMITS`, che `schemas.ts` riesporta.
   Il motore non importa nulla da `src/lib/admin/`.
5. **Servizio non leggibile:** restituisce subito una lista vuota, senza durata di ripiego.
6. **Argomenti della RPC senza cast:** `src/lib/db/database.ts` corregge i tipi generati (`p_barber_id` e `barber_id` nullable). Tutti i client Supabase lo usano.
7. **`availableDays`:** si ferma al primo slot di ogni giorno e salta le fasce già superate.
8. **`kind` come enum Postgres** `availability_kind`: i tipi generati sono già ristretti. Nel test di accettazione 17 è cambiata solo l'attesa sul tipo di ritorno, con l'approvazione dell'utente.

**Esiti dopo le migliorie**: lint ok, typecheck ok, Vitest 974/974, pgTAP 852/852, Playwright 65/65 (con `SUPABASE_SERVICE_ROLE_KEY` nell'ambiente).

**Correzione dopo la chiusura** (CI, 2026-10-04, approvata dall'utente)
- L'e2e "blocco e sblocco dell'account" (`admin-staff-accounts.spec.ts`) era instabile in CI. Se dopo il blocco una richiesta del browser del barbiere (per esempio un prefetch della build di produzione) passa dal proxy, i cookie vengono tolti in quel momento e la visita successiva di `/admin` arriva anonima, senza `?motivo=disabilitato`. Il comportamento è verificato con un test di prova in locale.
- Ora, dopo la revoca, il test verifica solo il redirect a `/admin/login` e l'assenza del menu admin. "Account disabilitato" resta verificato al nuovo login.
- Esclusa la gara fra progetti Playwright: lo spec gira solo in `mobile-chromium` e usa dati unici.

## Fetta 5 – Flusso prenotazione cliente + "Le mie prenotazioni"

**Stato**: completata, review chiusa (un giro, nessun bloccante; migliorie elencate sotto, da decidere). Migrazioni da applicare a Supabase cloud (`db push`); regola del firewall Vercel e Redirect URLs da configurare (`docs/DEPLOY.md` §5 e §7). CI da verificare dopo il push.

**Fatto**
- 4 migrazioni `2026100410*`:
  - `online_slot_error` (definer, solo `authenticated`): stesse regole del motore, fasce contigue unite con `range_agg`;
  - `create_online_booking` (definer, solo `authenticated`) con `fnv1a_32` interna: profilo completo con consenso alla versione corrente, blocco manuale o per no-show, nota ≤ 500, advisory lock per cliente, limiti 3 future / 10 nelle 24 ore, sovrapposizione del cliente, "Nessuna preferenza" scelta nel DB con il criterio di `pickBarber`;
  - `cancel_own_booking` (definer, solo `authenticated`), bordo del limite incluso;
  - policy `services_select_own_bookings` e `barbers_select_own_bookings`.
- `src/lib/booking/`: `rules`, `schemas`, `errors`, `actions` (`createBooking`, `cancelBooking`), `availability-actions`, `queries`, `paths`, `format`, `page-context`. `src/lib/db/database.ts` corregge i tipi di `create_online_booking` (`p_barber_id` e `p_notes` nullable). Denaro spostato in `src/lib/domain/money.ts` (re-export in `src/lib/admin/money.ts`).
- Pagine: home (info negozio, "Prenota", prossima prenotazione), `/prenota`, `/prenota/barbiere` (saltata con un solo barbiere), `/prenota/orario` (resa dal server dall'URL, cambio giorno senza ricaricare dopo l'idratazione), `/prenota/riepilogo`, `/prenotazioni`; link "Prenotazioni" nell'header.
- Ritorno dopo il login: il proxy aggiunge `?next=` (percorso e parametri); `next` viaggia codificato in `emailRedirectTo` e nel template come `next={{ .RedirectTo }}`; validato con `safeNextPath` all'invio e dopo la decodifica. Template e `additional_redirect_urls` aggiornati.
- Vitest: progetto `db` separato per i `*-db.test.ts`, un file alla volta.
- `docs/adr/005-prenotazione-online.md`; SPEC §3.7.6, §5.2, §5.3, §8; `DEPLOY.md` §5 e §7 (firewall Vercel); `GO-LIVE.md`.
- Test: `supabase/tests/19_online_booking.test.sql` (98), `tests/acceptance/booking-rules.test.ts` (21), `tests/acceptance/booking-db.test.ts` (8: coerenza motore/SQL, scelta del barbiere uguale a `pickBarber`, concorrenza reale), `tests/e2e/booking.spec.ts` (4).

**Esiti**: lint ok, typecheck ok, Vitest 1003/1003, pgTAP 950/950, Playwright 69/69 (con `SUPABASE_SERVICE_ROLE_KEY` nell'ambiente).

**Decisioni** (dettaglio nell'ADR 005)
- Rate limiting della creazione nel database, per cliente; per le richieste al flusso una regola del firewall Vercel (disponibile anche sul piano Hobby: 1 regola, chiave IP, finestra 10 s–10 min).
- Advisory lock per cliente prima dei controlli su limiti e sovrapposizioni; in pgTAP si verifica solo la presa del lock, la gara reale è in `booking-db.test.ts`.
- "Nessuna preferenza" nel database, nella stessa transazione, senza retry lato server.
- Sovrapposizione del cliente su `[starts_at, ends_at)`, senza buffer. Cancellazione con bordo incluso. Nota ≤ 500 caratteri.
- Login richiesto da `/prenota`; messaggio di blocco su `/prenota` e nel riepilogo.
- Dopo conferma e cancellazione redirect a `/prenotazioni` con banner.

**Correzioni ai test di accettazione** (approvate dall'utente)
- Prima del commit `f908fd4`: progetto Vitest `db`, ripristino dell'orizzonte in `finally`, caso dell'ora legale saltato con messaggio se non c'è un cambio d'ora nei prossimi 365 giorni.
- Dopo: in `19_online_booking.test.sql` il test "l'assenza di A non tocca B" usava un servizio a cui B non è abilitato (refuso), ora usa F5 Taglio.

**Da fare nelle prossime fette**
- Fetta 9: `profileComplete` non confronta la versione del consenso privacy, il database sì: un cliente con un consenso vecchio lo scopre alla conferma ("Completa il tuo profilo per prenotare").
- Produzione: `db push` delle 4 migrazioni; template email con `next={{ .RedirectTo }}`; Redirect URLs `https://<dominio>/**`; regola del firewall.

**Migliorie della review** (non applicate: decide l'utente)
1. Committare insieme il rename `admin/money.ts → domain/money.ts` e il nuovo re-export `src/lib/admin/money.ts` (usato da `admin-utils.test.ts`).
2. Con "Nessuna preferenza" un orario non valido per motivi indipendenti dal barbiere (troppo vicino, fuori orizzonte, fuori griglia, chiusura) restituisce `taken` ("Orario appena occupato").
3. `online_slot_error` distingue `time_off`, `closed` e `taken`: un cliente può dedurre le assenze di un barbiere (nessun dato di altri clienti). Ridurre i codici per i non staff tocca i test pgTAP 19.
4. La regola del firewall copre solo le POST; ogni GET di `/prenota/orario` calcola i giorni su tutto l'orizzonte. Inoltre `/prenota` richiede il login: la "disponibilità anonima" citata in ADR 005 e `DEPLOY.md` §7 oggi non è raggiungibile, il testo va allineato.
5. Se la lettura del profilo fallisce, `page-context.ts` tratta il cliente come bloccato.
6. Un errore di lettura delle prenotazioni mostra "Nessuna prenotazione." invece di un errore.
7. Un `next` oltre 2048 caratteri fa fallire lo schema del login (risposta "invalid" con un'email corretta).
8. Al primo accesso il redirect a `/profilo/completa` perde `next`.
9. Codice morto e duplicazioni: `home.callShop` inutilizzato, select e mapping duplicati in `queries.ts`, link `tel:` costruito in tre punti.
10. Mancano test unitari per `emailRedirectUrl` e `nextFromEmailLink`.
11. I limiti 500 e 3 sono scritti nei testi di `it.ts` invece che con un segnaposto.

