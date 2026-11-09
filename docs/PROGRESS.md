# Avanzamento

| Fetta | Stato | Data | Note |
|---|---|---|---|
| 0 | completata | 2026-10-02 | Vedi "Fetta 0" sotto |
| 1 | completata | 2026-10-02 | Vedi "Fetta 1" sotto |
| 2 | completata | 2026-10-02 | Vedi "Fetta 2" sotto |
| 3 | completata | 2026-10-03 | Vedi "Fetta 3" sotto |
| 4 | completata | 2026-10-04 | Vedi "Fetta 4" sotto |
| 5 | completata | 2026-10-04 | Vedi "Fetta 5" sotto |
| 6 | completata | 2026-10-05 | Vedi "Fetta 6" sotto |
| 6b | completata | 2026-10-05 | Vedi "Fetta 6b" sotto |
| 6c | completata | 2026-10-07 | Vedi "Fetta 6c" sotto |
| 7 | da fare | | |
| 8a | completata | 2026-10-06 | Vedi "Fetta 8a" sotto (identità visiva, prima della 8) |
| 8 | completata | 2026-10-10 | Vedi "Fetta 8" sotto; review chiusa, manca la prova su iPhone |
| 8b | completata | 2026-10-12 | Vedi "Fetta 8b" sotto; manca la prova su iPhone di "Aggiungi al calendario" |
| 8c | completata | 2026-10-12 | Vedi "Fetta 8c" sotto; manca la prova del tocco su iPhone |
| 8d | completata | 2026-10-16 | Vedi "Fetta 8d" sotto; manca la prova di caricamento da iPhone |
| 8e | completata | 2026-10-16 | Vedi "Fetta 8e" sotto; manca la prova su iPhone e una decisione su "oggi chiuso" |
| 8f | completata | 2026-10-25 | Vedi "Fetta 8f" sotto; manca la prova su iPhone |
| 8g | completata | 2026-10-30 | Vedi "Fetta 8g" sotto; scorrimento invariato (deciso su iPhone); punto 6 dell'audit chiuso il 2026-10-30 |
| 8h | completata | 2026-11-09 | Vedi "Fetta 8h" sotto; da rilasciare (prima `db push`, poi deploy); un e2e della 8j instabile sul branch (punto 1 dei problemi aperti) |
| 8i | da fare | | Correzioni admin: punti 5, 8 e 9 dell'audit |
| 8j | completata | 2026-10-31 | Vedi "Fetta 8j" sotto; una decisione aperta sui test (punto 1 dei problemi aperti) |
| 9a | completata | 2026-10-11 | Vedi "Fetta 9a" sotto |
| 9b | da fare | | Privacy e account prima del go-live (SPEC §11), con il punto 4 dell'audit |

Audit del 30 ottobre: vedi "Audit del 30 ottobre: pianificazione" in fondo.

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

**Stato**: completata, review chiusa (un giro, nessun bloccante; migliorie 2–11 applicate su richiesta dell'utente nel commit "fix: review fetta 5"). Migrazioni già presenti su Supabase cloud (verificato il 2026-10-05: il `db push` della fetta 6 ha applicato solo le 2 nuove); regola del firewall Vercel e Redirect URLs da configurare (`docs/DEPLOY.md` §5 e §7). CI da verificare dopo il push.

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

**Review: migliorie applicate** (su richiesta dell'utente; la review è chiusa)
1. Rename di `money.ts` e re-export committati insieme (commit della fetta).
2. "Nessuna preferenza": prima le regole del negozio (`online_slot_shop_error`), l'errore rispecchia la causa reale (`too_soon`, `too_far`, `closed`...); nessun barbiere libero → `unavailable`.
3. `online_slot_error` non distingue più assenza del barbiere e orario occupato (`unavailable`, "Questo orario non è disponibile"); la chiusura resta `closed`; "Orario appena occupato" resta per la gara sul vincolo di esclusione (`23P01`). Migrazione `20261004110000_online_slot_error_codes.sql`. **Limite noto (decisione dell'utente)**: `availability_inputs` (fetta 4, eseguibile anche da anon) espone ancora le assenze come `time_off` distinte da `busy`; unirle richiede di cambiare il motore.
4. ADR 005 e `DEPLOY.md` §7 allineati: `/prenota/**` richiede il login; la regola del firewall copre tutti i metodi su `/prenota` (anche le GET di `/prenota/orario`).
5. Profilo non leggibile: messaggio con invito a riprovare (`access: "error"`), non il blocco.
6. Prenotazioni non leggibili: messaggio d'errore in `/prenotazioni` e in home, non "Nessuna prenotazione".
7. `next` oltre 2048 caratteri scartato da `safeNextPath` (ritorno alla home); lo schema del login non fallisce; il link email accetta l'URL di redirect con la destinazione codificata (fino a 4096).
8. La destinazione passa da `/profilo/completa`: sia al primo accesso dal magic link sia quando il proxy ci manda un cliente con il profilo incompleto. Senza destinazione valida si arriva alla home (`destinationAfterLogin`).
9. `home.callShop` rimosso; colonne e mapping di "Le mie prenotazioni" in un solo punto (`MY_BOOKING_COLUMNS`, `toMyBooking`); link `tel:` da `telHref`.
10. Test unitari su `emailRedirectUrl`, `nextFromEmailLink`, lunghezza massima e destinazione.
11. Limiti nei testi con `{max}` (`bookingErrorText`, `ONLINE_BOOKING_LIMITS`).

**Versione dell'informativa in sola lettura** (richiesta dell'utente, legata alla fetta 9)
- In **Impostazioni** il campo è in sola lettura, senza `name`, con una nota: il cambio di versione arriverà con il flusso di nuovo consenso. `saveSettings` usa `editableSettingsSchema` e non scrive `privacy_policy_version`.
- Motivo: `create_online_booking` richiede il consenso alla versione corrente; cambiarla oggi impedirebbe a tutti i clienti di prenotare (`profile_incomplete`) senza modo di rinnovare il consenso.
- **Fetta 9**: introdurre il flusso di nuovo consenso (anche `profileComplete` deve confrontare la versione), poi rendere di nuovo modificabile la versione.

**Correzioni ai test durante la review** (approvate dall'utente)
- `19_online_booking.test.sql`: codici `time_off`/`taken` → `unavailable`; due casi nuovi per "Nessuna preferenza" (`too_soon`, `closed`); `plan(100)`.
- `booking-db.test.ts`: due attese `taken` → `unavailable`.
- `auth.spec.ts` (fetta 2): dopo il completamento del profilo arrivato da `/profilo` si torna a `/profilo`, non alla home.
- `admin-settings.spec.ts` (fetta 3): la versione dell'informativa non si compila più (sola lettura); il campo è verificato come non modificabile.
- Nuovi: `tests/acceptance/booking-review-fixes.test.ts`, `supabase/tests/20_review_fixes_fetta5.test.sql`, `tests/e2e/review-fixes-fetta5.spec.ts` (ritorno a `/prenota` dopo il completamento; `next` esterno o troppo lungo → home).

**Esiti dopo la review**: lint ok, typecheck ok, Vitest 1020/1020, pgTAP 955/955, Playwright 72/72.

**Stabilizzato dopo la review** (approvato dall'utente, commit "test: stabilizza e2e barbieri (fetta 3)"): `admin-barbers.spec.ts` ("crea un barbiere...") leggeva `barber_services` appena compariva la scheda, prima che i servizi fossero salvati (creazione non atomica, fetta 3 miglioria rimandata 6). Ora attende il redirect alla scheda, che arriva solo dopo il salvataggio dei servizi; asserzioni invariate. Verificato con `--repeat-each=10` (50/50).

## Fetta 6 – Calendario admin + prenotazioni manuali + cambi stato

**Stato**: completata, review chiusa (un giro, nessun bloccante; migliorie 1–10 applicate su richiesta dell'utente nel commit "fix: review fetta 6"). Fetta chiusa il 2026-10-05: le 2 migrazioni sono applicate a Supabase cloud (`db push` dell'utente; il vincolo sul cliente si è creato senza errori, quindi nel cloud non c'erano sovrapposizioni) e la CI è verde (confermato dall'utente).

**Fatto**
- Migrazioni:
  - `20261005090000_bookings_customer_no_overlap.sql`: vincolo di esclusione per cliente su `[starts_at, ends_at)`, solo `confirmed` con `customer_id`;
  - `20261005090100_barber_cancel_by_customer.sql`: il barbiere può fare `confirmed → cancelled_by_customer`.
- `src/lib/calendar/`:
  - puri: `grid`, `transitions`, `warnings`, `errors`, `edit`, `view`;
  - server: `queries`, `page-data`, `actions` (`createManualBooking`, `updateBooking` solo admin, `changeBookingStatus`, `saveStaffNote`, `searchCustomers`), `schemas`, `paths`.
- Pagine:
  - `/admin`: calendario, con vista giorno e vista settimana;
  - `/admin/calendario/nuova`;
  - `/admin/calendario/[id]`: dettaglio, stato, nota interna, modifica dell'admin;
  - `/admin/calendario` rimanda a `/admin`.
- Componenti in `src/components/admin/calendar/`, testi in `it.admin.calendar`.
- Altre modifiche:
  - `src/lib/db/database.ts`: in insert su `bookings` i campi calcolati dal trigger sono facoltativi;
  - `phoneSchema` esportato da `src/lib/auth/schemas.ts`;
  - `<main>` di `/admin` con `min-w-0`.
- Documentazione: `docs/adr/006-calendario-e-prenotazioni-manuali.md`; ADR 001 (transizioni del barbiere, vincolo sul cliente); SPEC §2, §3.7.5, §3.7.6, §6.1–6.3, §11 (nuova fetta 6b).
- Test (commit `116ed61`):
  - Vitest: `tests/acceptance/calendar-{logic,schemas,access,edit}.test.ts` (131 casi);
  - pgTAP: `supabase/tests/21_staff_calendar.test.sql` (35);
  - e2e: `tests/e2e/admin-calendar.spec.ts` (4).

**Esiti**: lint ok, typecheck ok, Vitest 1151/1151, pgTAP 990/990, Playwright 76/76 (con `SUPABASE_SERVICE_ROLE_KEY` nell'ambiente).

**Decisioni** (dettaglio nell'ADR 006)
- Clienti (§6.7) nella nuova fetta 6b.
- Regola 6 come vincolo del DB su tutti i percorsi; gli ospiti sono esclusi.
- Il barbiere può segnare "Disdetta dal cliente" (`cancelled_by_customer`).
- Avvisi (fuori fascia, assenza, chiusura, passato) con "Conferma comunque":
  - ricalcolati a ogni invio;
  - si salva se quelli attuali sono un sottoinsieme di quelli confermati (variante dell'utente);
  - la conferma non deroga mai alle sovrapposizioni.
- Modifica dell'admin:
  - cambiando servizio, durata e prezzo si ricopiano dal nuovo servizio;
  - gli avvisi valgono solo se cambiano orario, barbiere o fine di una `confirmed`.
- Griglia:
  - estesa alle prenotazioni del giorno, righe in tempo reale nei cambi d'ora;
  - cancellate nascoste, con conteggio e `?cancellate=1`.
- Vista settimana: un barbiere alla volta. Per l'admin il predefinito è la propria scheda se attiva, poi il primo attivo per nome.
- Transizioni dell'admin: quelle del barbiere più "Ripristina confermata" dagli stati finali. Nessuna eliminazione dall'interfaccia. Orario con passo di 5 minuti; ospite con telefono in E.164.

**Correzioni ai test di accettazione** (approvate dall'utente, nel commit `116ed61`)
- `04_rls_barber`: il barbiere ora può fare `cancelled_by_customer` (decisione 3).
- `09_security_hardening` e `19_online_booking`: dati di prova che violavano il nuovo vincolo sul cliente; bordi e asserzioni invariati.

**Problemi trovati dagli e2e durante l'implementazione**
- Dopo gli avvisi il reset di React riportava i `<select>` alla scelta del primo rendering, e "Conferma comunque" inviava un altro servizio. Ora i moduli si rimontano (`key`) con i valori inviati.
- Con molti barbieri (quelli creati dagli altri e2e in parallelo) la griglia allargava `<main>`, e i link delle colonne a destra non erano cliccabili (`<main> intercepts pointer events`). Corretto con `min-w-0` sul `<main>` del layout di `/admin`.

**Da fare nelle prossime fette**
- Fetta 6b (Clienti): elenco con ricerca, storico, contatore no-show, blocco/sblocco. Va deciso come l'admin toglie un blocco automatico per no-show: oggi il contatore segue solo le prenotazioni.

**Migliorie della review** (tutte applicate su richiesta dell'utente; la review è chiusa)
1. `updateBooking` e `createManualBooking` non verificano che servizio (in modifica) e barbiere siano attivi: i moduli li escludono, un POST costruito a mano no.
2. Cambio d'ora: un orario della seconda occorrenza delle 02:xx, salvato dalla modifica senza cambiarlo, torna sulla prima. Un orario inesistente (02:30 del 28/03) viene spostato senza avviso. Proposta: riusare `starts_at` se data e ora non cambiano.
3. Una prenotazione con minuti non multipli di 5 (seed o import) non si modifica più nemmeno nel solo prezzo (passo di 5 minuti). Stessa correzione del punto 2.
4. `src/lib/booking/errors.ts`: il `23P01` del vincolo sul cliente dentro `create_online_booking` diventa "Orario appena occupato" invece di "sovrapposizione del cliente".
5. Dettaglio e nuova prenotazione non intercettano gli errori di lettura: manca un `error.tsx` sotto `src/app/admin/(panel)/`.
6. `changeBookingStatus`: un cambio concorrente restituisce un `error` generico e l'azione non ha try/catch. `saveStaffNote`: cancellare la nota di una prenotazione non visibile risponde "salvato".
7. Settimana di un barbiere disattivato (`?barbiere=`): il link "Nuova prenotazione" porta in silenzio al primo barbiere attivo.
8. Le righe nel buffer dopo una prenotazione restano cliccabili; il DB poi rifiuta con "barbiere occupato".
9. Ricerca clienti senza indicatore di caricamento; un errore della RPC appare come "Nessun cliente trovato".
10. `src/i18n/it.ts` in CRLF nella copia di lavoro (git normalizza al commit).

**Come sono state applicate le migliorie** (regressioni in `tests/acceptance/calendar-review-fixes.test.ts`, 18 casi)
1. `createManualBooking` e `updateBooking` leggono `is_active` di servizio e barbiere: una scelta nuova disattivata → "Il servizio o il barbiere scelto è disattivato". In modifica restano ammessi servizio e barbiere già sulla prenotazione (`usesInactiveChoice`).
2–3. Se data e ora del modulo sono quelle salvate, la modifica riusa `starts_at` (`unchangedStart`): nessuno spostamento nell'ora ripetuta del 25/10 e nessun blocco per minuti non multipli di 5. Gli orari nuovi passano da `exactLocalDateTimeToUtc`: un'ora inesistente (02:30 del 28/03) → "Questo orario non esiste per il cambio dell'ora legale", anche nelle manuali.
4. `rpcErrorCode` in `src/lib/booking/errors.ts`: un `23P01` di `bookings_customer_no_overlap` nella prenotazione online → `customer_overlap`.
5. `src/app/admin/(panel)/calendario/error.tsx` (dettaglio e nuova prenotazione), con "Riprova".
6. Il pulsante di stato invia lo stato mostrato (`expectedStatus`): se nel frattempo è cambiato, o l'update tocca 0 righe → "La prenotazione è stata modificata nel frattempo: ricarica la pagina". Una transizione non ammessa resta `forbidden`. L'azione ha il try/catch. La nota interna controlla prima che la prenotazione sia visibile: altrimenti errore, mai "salvato".
7. `/admin/calendario/nuova` con un `?barbiere=` disattivato o non visibile mostra un avviso invece di cambiare barbiere in silenzio (`newBookingBarber`). Nella settimana di un barbiere disattivato e nella sua colonna del giorno non ci sono link di nuova prenotazione.
8. La griglia considera occupate le righe fino a `blocked_until` (`busyRows`): le righe del buffer non sono cliccabili e si vedono come occupate ("Pausa dopo l'appuntamento").
9. Ricerca clienti: "Ricerca in corso…" mentre aspetta; un errore della RPC → "Ricerca non riuscita", distinto da "Nessun cliente trovato" (`searchCustomers` restituisce `{ ok }`).
10. `src/i18n/it.ts` normalizzato a LF.

**Esiti dopo le migliorie**: lint ok, typecheck ok, Vitest 1169/1169, pgTAP 990/990.
- Playwright in dev (`npm run test:e2e`, con `SUPABASE_SERVICE_ROLE_KEY`): 69–72/76. Falliscono al login, a seconda del giro, 1–4 test di `admin-periods.spec.ts` (fetta 3): il redirect a `/admin` non arriva entro 5 s.
- Lo stesso succede sul commit della fetta (`6dad6ec`, senza queste migliorie). Causa: dalla fetta 6 `/admin` è il calendario, che in dev si compila al primo accesso mentre i primi test fanno login in parallelo.
- Su build di produzione (`npm run build && npm run start`) `admin-periods` passa sempre (2 giri; suite in 35 s invece di 1,3 min). In quei giri falliscono solo i 3 test degli account staff: lì il server avviato a mano non vedeva `SUPABASE_SERVICE_ROLE_KEY`, che è un problema dell'ambiente locale. In dev con la chiave passano.

**E2E in dev stabilizzati** (decisione dell'utente, commit "test: warm-up pagine per e2e in dev")
- `tests/e2e/global-setup.ts` (`globalSetup` di Playwright), solo quando non si usa la build di produzione (`CI` non impostato). Carica una volta:
  - `/admin/login`;
  - le pagine dell'area staff, con l'admin demo;
  - `/accedi` e le pagine del flusso cliente, con il cliente demo e il magic link via Mailpit.
- Nessuna asserzione cambiata. Se il warm-up fallisce stampa solo un avviso.
- Verificato con 3 giri completi in dev: 76/76 ogni volta.

## Fetta 6b – Admin: clienti (SPEC §6.7)

**Stato**: completata, review chiusa (un giro, nessun bloccante; migliorie 1–6 applicate o accettate su richiesta dell'utente nel commit "fix: review fetta 6b"). Le 4 migrazioni `20261005*` sono applicate a Supabase cloud (`db push` dell'utente, 2026-10-05, senza errori). CI verde dopo il push del 2026-10-05 (`948daa4`), confermata dall'utente.

**Fatto**
- Migrazioni:
  - `20261005100000_profiles_no_show_reset.sql`:
    - colonne `no_show_reset_at` e `no_show_reset_by`, con indice sulla FK e senza grant di update;
    - contatore no-show che rispetta l'azzeramento, con il trigger anche su `starts_at`;
    - `reset_no_show_count` (definer, solo admin non bloccato, solo `customer`, `P0002` altrimenti);
  - `20261005100100_admin_customers.sql`: `admin_customers`, `admin_customer` (definer, `is_admin()` interno, email da `auth.users`), `blocked_customer_ids` (definer, solo staff).
- `src/lib/customers/`: `status` (puro), `schemas`, `paths`, `queries`, `actions` (`setCustomerBlocked`, `resetNoShows`).
- Pagine:
  - `/admin/clienti`: ricerca GET su nome, telefono ed email, 25 per pagina, stato del blocco;
  - `/admin/clienti/[id]`: dati, stato, contatore, ultimo azzeramento, Blocca/Sblocca, Azzera no-show, storico (max 100 righe);
  - `error.tsx`.
- Prenotazione manuale: `searchCustomers` restituisce `blocked`, mostrato come etichetta "Bloccato". Se `blocked_customer_ids` fallisce: avviso, `blocked: null` e log dell'errore.
- Testi in `it.admin.customers` e `it.admin.calendar.form.customerBlocked/customerBlockUnknown`.
- Documentazione: `docs/adr/007-clienti.md`; ADR 001 (significato del contatore); SPEC §3.1 e §6.7.
- Test (commit `fbd3102`):
  - pgTAP `supabase/tests/22_admin_customers.test.sql` (72);
  - Vitest `tests/acceptance/customers.test.ts` (50);
  - e2e `tests/e2e/admin-customers.spec.ts` (3).

**Esiti**: lint ok, typecheck ok, Vitest 1219/1219, pgTAP 1062/1062, Playwright 79/79 (dev, con `SUPABASE_SERVICE_ROLE_KEY`).

**Decisioni** (dettaglio nell'ADR 007)
- Azzeramento dei no-show con `no_show_reset_at`/`no_show_reset_by`. Da quel momento `no_show_count` conta solo le no-show di prenotazioni con `starts_at >= no_show_reset_at`.
- Il perdono copre il passato: una no-show segnata dopo l'azzeramento su una prenotazione precedente non conta, e correggere o eliminare una vecchia no-show non decrementa. Il cambio di `customer_id` segue l'azzeramento di ciascun cliente.
- Blocca/Sblocca agisce solo su `is_blocked` e solo sui `customer`. Non cancella prenotazioni né chiude la sessione: impedisce solo la prenotazione online.
- Email visibile e cercabile solo dall'admin, tramite funzioni definer con `is_admin()` interno: un admin bloccato non le usa.
- Etichetta "Bloccato" nella manuale con la funzione separata `blocked_customer_ids` (`search_customers` invariata, il suo test in `04_rls_barber` resta valido). Il barbiere vede il blocco anche di clienti mai serviti.
- `q` troncato a 100; pagina non valida → 1; `p_offset` negativo → 0; oltre l'ultima pagina, elenco vuoto con il link alla prima.
- Errori del database: `42501` → "Operazione non consentita", il resto (`P0002`...) → errore generico. Cliente bloccato sia dall'admin sia per no-show → due etichette.

**Correzioni ai test di accettazione**: nessuna dopo il commit `fbd3102`. Prima del commit spec-qa aveva adeguato due casi della propria prima consegna alle decisioni 4 e 7: un dato di prova (`count: 1`) e l'atteso `blockStatusUnknown: false`.

**Problemi d'ambiente trovati durante gli e2e**
- `booking.spec.ts` (fetta 5) cerca le email in Mailpit, che restituisce al massimo 50 messaggi. Con 50 email accumulate per `cliente@demo.local` il test non vede quella nuova. Risolto svuotando la casella locale (`DELETE http://127.0.0.1:54324/api/v1/messages`); il test resta fragile (miglioria 6).
- Non lanciare gli e2e in background mentre gira `npm test`, ad esempio con il quality gate di fine turno: il progetto Vitest `db` scrive sul database e la CPU satura. I login dello staff vanno in timeout in dev, e falliscono anche sulla build di produzione.
- Un caso di `calendar-schemas.test.ts` è andato in timeout (5 s) al primo giro a freddo e sotto carico. Non si ripete a macchina libera.

**Migliorie dalla review** (decisioni dell'utente sotto, in "Come sono state applicate")
1. Race tra azzeramento e una no-show segnata in contemporanea. In READ COMMITTED il +1 del trigger, valutato prima del commit dell'azzeramento, si applica dopo e non viene mai stornato. Correzione: mettere la condizione su `no_show_reset_at` nel `WHERE` dell'update del contatore (o `select ... for update` sul profilo). Finestra stretta: servono due admin contemporanei.
2. `no_show_reset_at`/`no_show_reset_by` (uuid dell'admin) sono leggibili anche dal cliente stesso e dal barbiere dei suoi appuntamenti (`grant select` su tutto `profiles`). Da rivedere con i grant di colonna su `profiles` o da accettare nell'ADR 007.
3. `getCustomer` ignora l'errore nella lettura del nome di chi ha azzerato (mostra "—" senza log).
4. `service_role` può eseguire le 4 funzioni nuove (inoffensivo: senza JWT danno 42501), a differenza di `search_customers`, che ha il revoke esplicito.
5. Classe del badge "bloccato" ripetuta tre volte: estrarre un `BlockedBadge`.
6. `booking.spec.ts`: rendere robusta la lettura da Mailpit (filtro o paginazione, oppure svuotare la casella in `global-setup.ts`). Tocca test esistenti.

**Come sono state applicate le migliorie** (commit "fix: review fetta 6b")
1. Migrazione `20261005120000_no_show_count_atomic_reset.sql`: il trigger del contatore mette la condizione sull'azzeramento nel `WHERE` (e nel `SET`) dell'update del profilo, che Postgres ricontrolla dopo l'attesa del lock. Test di regressione in `tests/acceptance/customers-review-fixes-db.test.ts`, progetto Vitest `db`: due sessioni `psql` nel container (`docker exec`), un azzeramento che tiene il lock e una no-show precedente segnata nel frattempo. Prima della correzione il contatore finiva a 1, ora a 0.
2. Accettata e documentata nell'ADR 007: le colonne di azzeramento sono leggibili dal cliente e dal barbiere, e contengono solo una data e l'id interno dell'admin.
3. `getCustomer` scrive nel log l'errore di lettura dell'autore dell'azzeramento.
4. Migrazione `20261005120100_customers_functions_no_service_role.sql`: revoke da `service_role` sulle 4 funzioni. pgTAP `supabase/tests/23_review_fixes_fetta6b.test.sql` (4).
5. Componente `BlockedBadge` (`src/components/admin/customers/blocked-badge.tsx`), usato nella sezione Clienti e nella ricerca della manuale.
6. `booking.spec.ts` (con l'ok dell'utente): invece di contare i risultati, che Mailpit restituisce al massimo 50 per volta, confronta l'id dell'email più recente prima e dopo la richiesta del link. Verificato con 63 messaggi per `cliente@demo.local`: 4/4.
- `CLAUDE.md`: regola sulle suite lunghe da non lasciare in background a fine turno.

**Esiti dopo le migliorie**: lint ok, typecheck ok, Vitest 1220/1220, pgTAP 1066/1066.
- Playwright con `--workers=3`: 79/79.
- Con i worker predefiniti 1–20 test falliscono al login dello staff (redirect a `/admin` oltre 5 s in dev). Nessun processo dell'app rimasto attivo, ma sulla macchina girano applicazioni pesanti (un gioco, Docker Desktop): è un problema di carico, non del codice.

**Helper Mailpit condiviso e worker locali** (richiesta dell'utente, commit "test: helper Mailpit condiviso e worker locali")
- `tests/e2e/mailpit.ts` (`newestEmailId`, `waitForNewEmail`, `confirmHref`): usato da `auth.spec.ts`, `booking.spec.ts`, `review-fixes-fetta5.spec.ts` e `global-setup.ts`. Funziona così:
  - prima di richiedere l'email legge l'id del messaggio più recente per quel destinatario;
  - attende un messaggio più recente con un id diverso;
  - non conta i risultati, quindi il limite di 50 della ricerca Mailpit non conta più.
  Nessuna asserzione cambiata.
- `playwright.config.ts`: in locale `workers: "25%"` (4 su 16 core logici); in CI resta il default. Il default di Playwright è già il 50% dei core, cioè gli 8 worker con cui la suite falliva: per questo è stato scelto il 25% invece del 50% proposto come esempio.
- Verifica: 66 email per `cliente@demo.local` e 62 per `admin@demo.local` (la ricerca ne restituisce 50). Playwright 79/79 con 4 worker, warm-up completo.

## Fetta 6c – Spostamento con trascinamento sul calendario

**Stato**: completata, review chiusa (un giro, un bloccante corretto; migliorie 1–8 applicate su richiesta dell'utente nel commit "fix: review fetta 6c"). Hash di partenza `b091929`, test di accettazione nel commit `fa5e268`. Migrazioni `20261007090000` e `20261007110000` applicate a Supabase cloud (`db push` dell'utente, 2026-10-07, senza errori).

**Fatto**
- Migrazione `20261007090000_barber_move_own_booking.sql`: `bookings_before_write` permette al barbiere di cambiare solo `starts_at` di una propria `confirmed` non iniziata, senza cambiare lo stato nello stesso update. Nessun cambio di schema (tipi invariati).
- `src/lib/calendar/move.ts` (puro): `dropStart`, `canDrag`, `canDropOn`.
- `src/lib/calendar/schemas.ts`: `moveBookingSchema`, `moveBookingFormSchema`.
- `src/lib/calendar/actions.ts`: `moveBooking` (oggetto, esiti `saved` con `previousWarnings`, `warnings`, `stale`, `forbidden`, `inactive`, `invalid`, errori del DB) e `moveBookingFromForm` (modulo "Sposta orario" del dettaglio).
- UI:
  - `day-grid.tsx` diventa client con `@dnd-kit/core` (mouse 5 px, touch 250 ms), colonne con `data-barber-id`, schede trascinabili con `data-draggable="true"`;
  - `use-booking-move.ts`: spostamento ottimistico, dialogo degli avvisi, "Annulla spostamento" per 8 s;
  - `move-feedback.tsx` (regione `role="status"` e `AlertDialog`), `move-booking-form.tsx`, `src/components/ui/alert-dialog.tsx` (Radix, solo token);
  - pagine: calendario (ruolo, scheda propria, `now`) e dettaglio (modulo per il barbiere sulle proprie confirmed future).
- Testi in `it.admin.calendar.move`.
- Documentazione: ADR 008; ADR 001 (regole del barbiere); SPEC §2, §6.3, §11 (riga 6c).
- Test:
  - accettazione (commit `fa5e268`): pgTAP `26_barber_move` (19), Vitest `calendar-move.test.ts` (43) e `calendar-move-db.test.ts` (21), e2e `admin-calendar-move.spec.ts` (3);
  - regressione della review: `tests/acceptance/calendar-move-form-db.test.ts` (6).

**Esiti**: lint ok, typecheck ok, Vitest 1366/1366, pgTAP 1109/1109, Playwright 91/91 (dev, con `SUPABASE_SERVICE_ROLE_KEY`, prima dei 6 test di regressione, che toccano solo Vitest).

**Decisioni dell'utente in questa sessione**
- "Annulla" nel dialogo degli avvisi, "Annulla spostamento" dopo il salvataggio.
- `AlertDialog` (`role="alertdialog"`) invece di `Dialog`.
- Una prenotazione non più `confirmed` → `stale`, non `forbidden`.
- Nessun trascinamento del passato per nessuno (nemmeno l'admin che è anche barbiere).

**Correzioni ai test** (approvate dall'utente)
- Prima del commit `fa5e268`: e2e con `alertdialog`, test DB con `stale` atteso, test dei due testi "Annulla"/"Annulla spostamento".
- Dopo il commit, per la nuova regola: `04_rls_barber` #55 (atteso `23P01`), `21_staff_calendar` #25 (`rows:1`) e #35 (posizione spostata, resto invariato).

**Problemi trovati durante l'implementazione**
- Windows riservava le porte 53748–54347 (Supabase usa 54321–54322): risolto dall'utente con `net stop winnat` / `net start winnat`.
- Dopo il rilascio dnd-kit ferma la propagazione del click ma non l'azione predefinita: il link della scheda apriva il dettaglio. Ora un listener nativo in cattura annulla solo quel click.

**Migliorie della review** (applicate su richiesta dell'utente, sotto)
1. "Annulla spostamento" dopo uno spostamento nel passato fallisce con `forbidden` (la posizione di partenza dell'annullamento è passata). Non offrirlo, oppure ammettere l'annullamento dello spostamento appena fatto.
2. Il barbiere può spostare una prenotazione nel passato e poi segnarla no-show (già possibile con una manuale nel passato): annotarlo nell'ADR 008 o vietargli le destinazioni passate.
3. `moveBooking` tratta un errore di lettura come `forbidden`/`invalid` invece di `error` (stesso schema di `updateBooking`).
4. Testi inutilizzati `move.dragHint` e `move.invalid`.
5. `now` fisso al rendering: con la pagina aperta a lungo una prenotazione iniziata resta trascinabile (il server risponde `forbidden`).
6. Riga vuota doppia in `day-grid.tsx`.
7. "Annulla spostamento" alto 36 px: portarlo a 44 px per l'uso da tablet.
8. Commento troppo lungo nel dettaglio.

**Come sono state applicate le migliorie** (commit "fix: review fetta 6c")
1–2. Decisione dell'utente che rivede il piano: nessuna destinazione nel passato, né trascinando né con "Sposta orario". Esito `past_target` ("Non si può spostare una prenotazione su un orario già passato.") prima degli avvisi e senza deroghe; il rilascio nel passato non chiama il server. Per il barbiere lo vieta anche il trigger (`new.starts_at > now()`, migrazione `20261007110000_barber_move_no_past_target.sql`). Per gli orari passati l'admin usa il modulo di modifica. Così "Annulla spostamento" non parte mai da una posizione passata, e il barbiere non può portare una prenotazione nel passato per segnarla no-show. Test adeguati con l'ok dell'utente: pgTAP `26_barber_move` (destinazione passata → `42501`), `calendar-move-db.test.ts` (admin e barbiere → `past_target`), `calendar-move-form-db.test.ts` (+1). ADR 008, ADR 001 e SPEC §6.3 aggiornati.
3. `moveBooking`: un errore nella lettura della prenotazione, della scheda propria (`current_barber_id` letto con l'errore) o del barbiere di arrivo finisce nel catch → `error`.
4. Rimossi `move.dragHint` e `move.invalid`.
5. Le schede mostrano la trascinabilità con l'ora del server, ma quando si afferrano `canDrag` si ricontrolla con l'ora corrente: un appuntamento iniziato nel frattempo resta un link al dettaglio.
6. Formattazione: riga vuota doppia in `day-grid.tsx`, commento del dettaglio a capo.
7. "Annulla spostamento" con l'altezza predefinita dei pulsanti (44 px).
- `day-grid.tsx`: il controllo della destinazione nel passato usa `Date.now()` con `eslint-disable-next-line react-hooks/purity` e un commento. È un falso positivo: `onDragEnd` la chiama solo dnd-kit al rilascio. `canGrab` è chiamata solo alla pressione sulla scheda e usa `new Date()` per `canDrag`; il lint non la segnala.

**Esiti dopo le migliorie**: lint ok, typecheck ok, Vitest 1368/1368, pgTAP 1109/1109.
- Playwright: 91/91 al secondo giro completo.
- Al primo giro completo il caso "l'admin trascina … nella colonna di Mario" è fallito una volta: la scheda è finita nella colonna di Sara. Quel giro ne ha contati solo 88 (87 passati, 1 fallito).
- Da sola la spec passa 12/12 (`--repeat-each=4`). La causa è stata poi trovata e corretta (sezione successiva).

**Indagine sull'e2e instabile e correzioni** (2026-10-07, commit "fix: autoscroll e destinazione visibile nel trascinamento")
- **Cosa è successo**
  - **Causa:** l'autoscroll di dnd-kit. I barbieri creati dagli altri e2e (`E2E …`) vengono prima di Luca in ordine alfabetico, quindi con la suite completa la griglia è più larga della finestra e Mario finisce vicino al bordo destro. Trascinando lì, l'autoscroll (soglia predefinita del 20%) faceva scorrere la griglia sotto il puntatore fermo, e al rilascio sotto c'era Sara.
  - **Riproduzione:** con 6 barbieri `E2E` attivi in più, il test falliva 3 volte su 3; con l'autoscroll disattivato, lo stesso scenario passava 3 volte su 3. La collision detection era già `pointerWithin`.
  - **88 test invece di 91:** il progetto `admin-settings` (3 test) dipende da `mobile-chromium`, e Playwright non lo esegue se lì fallisce un test. Il riepilogo "3 did not run" c'era, ma il filtro con cui leggevo l'output lo scartava.
  - **Secondo problema, trovato con l'e2e di regressione:** la scheda originale si spostava con un `transform` dentro il contenitore che scorre e ne allargava l'area, quindi l'autoscroll verso destra non finiva mai.
- **Decisioni dell'utente:** autoscroll limitato ai bordi estremi; destinazione sempre visibile durante il trascinamento; niente ripiego su `rectIntersection`; reporter che fa fallire un giro con test non eseguiti.
- **Correzioni**
  - Autoscroll solo vicino ai bordi estremi: `threshold` 5% in orizzontale, 20% in verticale.
  - Durante il trascinamento la colonna di arrivo ha un contorno pieno (`data-drop-target`). La copia trascinata (`DragOverlay`) mostra barbiere e orario di arrivo, ad esempio "Mario, 10:30" (`data-drop-preview`, testo `it.admin.calendar.move.dropPreview`).
  - Anteprima e rilascio usano la stessa funzione pura `dropTarget` in `move.ts`. Test: `tests/acceptance/calendar-drop-target.test.ts` (4).
  - La scheda originale resta al suo posto, tratteggiata: si trascina la copia.
  - e2e "colonna di Mario" (con l'ok dell'utente): `dragTo` con `centerTarget` porta al centro la colonna di destinazione prima di trascinare.
  - Nuovo e2e di regressione `tests/e2e/admin-calendar-move-autoscroll.spec.ts`, con 6 colonne extra: dopo l'autoscroll la prenotazione finisce nella colonna indicata durante il trascinamento.
  - `cleanup` (`admin-helpers.ts`): se l'eliminazione dei barbieri fallisce li disattiva, per non lasciare colonne in più agli altri test. Tutti gli e2e che creano barbieri li puliscono già nel `finally`; dopo le suite il DB contiene solo Luca, Mario e Sara.
  - Reporter `tests/e2e/run-summary-reporter.ts` (in locale e in CI). A fine giro stampa "eseguiti X su N" e fa fallire il giro se ci sono test non eseguiti senza uno skip esplicito, o se non è stato eseguito nessun test (es. server web non partito). Verificato con un test fallito apposta: elenca i 3 test di `admin-settings` non eseguiti.
- **Esiti:** lint ok, typecheck ok, Vitest 1372/1372, pgTAP 1109/1109, Playwright 92/92 ("eseguiti 92 su 92").
- **Sotto carico:** lo scenario che prima falliva (6 colonne extra) ora passa 4/4. Ho poi lanciato la suite completa in contemporanea con i due spec del trascinamento ripetuti 3 volte: il trascinamento è passato 12/12 nella ripetizione e in tutti i test della suite. Nella suite sono falliti solo i 3 test degli account staff, perché il dev server avviato a mano non aveva `SUPABASE_SERVICE_ROLE_KEY` (problema d'ambiente già noto).

**Da fare**
- Verifica manuale del touch su viewport iPhone (pressione prolungata, scorrimento, nessun menu del link né selezione del testo).
- Fetta 7: notifica al cliente dello spostamento (anche da trascinamento e annullamento).

**Decisioni approvate**
- Admin: sposta qualunque `confirmed` non iniziata, anche tra colonne. Barbiere (non admin): solo le proprie `confirmed` non iniziate, solo nell'orario. Admin che è anche barbiere = admin.
- Migrazione: `bookings_before_write` permette al barbiere di cambiare solo `starts_at` se `old.status = 'confirmed'`, stato invariato e `old.starts_at > now()`; tutto il resto resta vietato; RLS invariata; vincoli di esclusione validi. Test pgTAP.
- Trascinabili solo le `confirmed` future; aggancio alle righe della griglia (`slot_granularity_min`, default 15); solo vista giorno; destinazione nel passato ammessa con avviso `past`.
- Logica pura `src/lib/calendar/move.ts`: `dropStart(grid, bookingStartsAt, deltaRows)`, `canDrag(...)`, `canDropOn(...)`.
- Server action `moveBooking(input)` (oggetto, non FormData; `moveBookingSchema`): `id`, `barberId`, `startsAt` ISO, `expectedBarberId`, `expectedStartsAt`, `confirmedWarnings`. Esiti `saved` (con `previousWarnings` della posizione originale), `warnings`, `invalid`, `stale`, `inactive`, `barber_busy`, `customer_busy`, `not_enabled`, `forbidden`, `error`. Nucleo comune con `updateBooking`; update filtrato su stato, barbiere e inizio attesi (concorrenza → `stale`). Durata e prezzo mai cambiati.
- UI con `@dnd-kit/core`: mouse dopo 5 px, touch con pressione prolungata 250 ms (tolleranza 5 px); spostamento ottimistico; avvisi → dialogo "Conferma comunque"/"Annulla"; errore → scheda al suo posto con messaggio; dopo il salvataggio "Annulla" per 8 s.
- Annulla: `moveBooking` all'indietro con `confirmedWarnings = previousWarnings`; se compare un avviso nuovo si mostra il dialogo (regola della fetta 6). Con test.
- Esito annunciato anche in una regione aria-live (`role="status"`). Schede trascinabili con `-webkit-touch-callout: none` e `user-select: none`, `data-draggable="true"`; colonne con `data-barber-id`.
- Alternativa accessibile: nel dettaglio, modulo "Sposta orario" (data + ora) per il barbiere sulle proprie `confirmed` future, stessa logica. Niente sensore da tastiera.
- Testi in `it.admin.calendar.move`.
- Verifica manuale del touch su viewport iPhone (pressione prolungata, scorrimento, nessun menu del link né selezione del testo).
- Da annotare per la fetta 7: notifica al cliente dello spostamento (anche da trascinamento e annullamento).

## Fetta 8a – Identità visiva (tema "Mosca")

**Stato**: completata, review chiusa (un giro, nessun bloccante; migliorie 1–10 applicate su richiesta dell'utente nel commit "fix: review fetta 8a", la 11 annotata). Le 3 migrazioni `20261006*` sono applicate a Supabase cloud (`db push` dell'utente, 2026-10-06, senza errori). CI da verificare dopo il push di `89edf68`. In produzione il nome "Mosca Barber Shop" va impostato da Impostazioni (il seed vale solo in locale).

**Fatto**
- Design system a token:
  - `src/styles/tokens.css`: nomi semantici e mappa verso shadcn e Tailwind, nessun valore;
  - `src/themes/mosca/`: valori (`theme.css`), font (`fonts.ts`, Bodoni Moda e Hanken Grotesk con `next/font`), marmo, mosca, `index.ts`;
  - `src/themes/active.ts`: unico punto in cui si sceglie il tema, e importa il CSS del tema.
- Primitive sui token (`button`, `input`, `label`, `src/components/ui/field.ts` per `select` e `textarea`): raggio 0, bordo di 1px, 44px, focus a contorno pieno, disabilitato con i suoi colori.
- Home: testata in marmo con la mosca in volo (scia di un giro, ferma con `prefers-reduced-motion`), nome dalle impostazioni (prima parola in grande, resto in corsivo), stato di apertura, blocco nero con la prossima prenotazione, "Prenota", orari della settimana, indirizzo e "Chiama".
- Flusso: intestazione dei passi in Bodoni, scelte a bordo nero, caselle dei giorni (scelto nero, senza orari tratteggiati), orari raggruppati per ora con i minuti (un salto di ore fa da divisore), mosca sullo slot toccato durante il caricamento (`useLinkStatus`), riepilogo e Le mie prenotazioni coerenti.
- Admin con gli stessi token, senza marmo né mosca:
  - calendario con ore intere in evidenza, stati con bordi (confermata nera, no-show rossa con stato scritto, cancellata tratteggiata) e tratteggio per assenze e chiusure;
  - menu orizzontale su mobile.
- Testata clienti e titolo della pagina con il nome da `shop_settings`; sulla home la testata non ripete il nome.
- Migrazione `20261006090000_shop_opening_hours.sql`: `shop_opening_hours()` (unione delle fasce dei barbieri attivi) e `shop_closures_today()` (solo inizio e fine, giorno locale, `[inizio, fine)`), definer, eseguibili da anon e authenticated. Seed con "Mosca Barber Shop".
- `src/lib/shop/`: `openingStatus` (pura), `splitShopName`, `getOpeningData`. `getShopInfo` con `cache()` di React.
- Documentazione: `docs/DESIGN.md` (principi, token, marmo e mosca, cosa NON fare, nuovo tema), richiamato da CLAUDE.md; SPEC §5.1 (orari e stato di apertura) e §11 (riga 8a).
- `.mcp.json` (Playwright MCP, solo Windows per `cmd /c`); `.playwright-mcp/` in `.gitignore`.
- Test (commit `f5d0643`):
  - Vitest: `tests/acceptance/shop-opening.test.ts` (25), `tests/acceptance/theme.test.ts` (16);
  - pgTAP: `supabase/tests/24_shop_opening_hours.test.sql` (15);
  - e2e: `tests/e2e/theme.spec.ts` (3).

**Esiti**: lint ok, typecheck ok, Vitest 1261/1261, pgTAP 1081/1081, Playwright 82/82 (dev, 4 worker, con `SUPABASE_SERVICE_ROLE_KEY`). Verifica visiva con Playwright MCP a 390 e 1280px di home, flusso e calendario admin. Sulla build di produzione i valori del tema prevalgono: `--background` #fff, raggio 0, testata #171717, font del tema.

**Decisioni**
- Il pulsante resta "Prenota".
- Un tocco sull'orario porta al riepilogo, senza barra "Continua". Lo slot mostra ":15"; nome accessibile (`aria-label`) e innerText restano "HH:MM", con l'ora nel testo a `font-size: 0` dentro un solo span (gli e2e lo leggono).
- Orari del negozio = unione delle fasce dei barbieri attivi, meno le chiusure di oggi (due funzioni, nessun dato del singolo barbiere né motivo).
- Rosso `#A4161A` solo per errori e azioni distruttive. Gli errori hanno sempre testo esplicito e un filetto a sinistra.
- Il CSS del tema si importa da `src/themes/active.ts`. Foto dei barbieri quadrate e in scala di grigi, iniziale in Bodoni se manca la foto.
- 09 e 10: le due funzioni pubbliche aggiunte all'elenco delle eccezioni per anon (approvato dall'utente).

**Problemi trovati durante l'implementazione**
- Il nome accessibile dello slot con l'ora in `sr-only` diventava "17 :00", e l'innerText con il link flex "22
:30". Corretto senza toccare i test.
- Il dev server avviato a mano senza `SUPABASE_SERVICE_ROLE_KEY` fa fallire gli e2e degli account staff ("A server error occurred"). Per gli e2e conviene lasciare che lo avvii Playwright.
- Fermando `npm run dev`/`start` da Claude Code su Windows resta in ascolto il processo figlio di Next sulla porta 3000: va terminato a mano.

**Migliorie dalla review** (decisioni dell'utente sotto, in "Come sono state applicate")
1. Focus quasi invisibile su fondo nero (link "Le mie prenotazioni" nel blocco nero): outline `--ring` = nero.
2. Focus non esplicito su giorni, orari, scelte, "Indietro" e link della testata: si affidano al contorno del browser, a differenza delle primitive.
3. Giorni senza orari: `aria-disabled`/`aria-label` su `span` (ruolo generico) non vengono letti. Meglio un testo `sr-only` ("nessun orario libero").
4. Variante `secondary` di Button con bordo `--line` (1,4:1), contraria a DESIGN.md; oggi non è usata.
5. Timezone di riserva `"Europe/Rome"` scritta a mano nella home quando `shop` è null.
6. `openingStatus` lancia un'eccezione su un orario non valido (es. `24:00` scritto direttamente in `working_hours`, che lo ammette): la home si romperebbe.
7. `shop_closures_today` non è testata nei giorni del cambio d'ora (usa `now()` reale).
8. Il testo sul marmo usa `--marble-vein`: per altri temi servirebbe un token `--ink-on-marble`.
9. `.mcp.json` con `@playwright/mcp@latest`: versione da fissare.
10. `dayParts` e `formatLongDate` senza test unitari.
11. `generateMetadata` nel root layout legge le impostazioni con i cookie: tutte le route diventano dinamiche.

**Come sono state applicate le migliorie** (commit "fix: review fetta 8a")
1–2. Focus unico: `:focus-visible` in `globals.css` (contorno pieno di 2px, staccato di 2px, colore `--ring`) per ogni elemento interattivo. La classe `on-ink` (`tokens.css`) rende il contorno chiaro sul blocco nero e sul marmo.
3. Giorni senza orari: contenuto visivo `aria-hidden` e testo `sr-only` "{giorno}, nessun orario libero" (`it.booking.time.dayUnavailable`).
4. Variante `secondary` di Button a bordo nero.
5. Home: il fuso orario viene solo da `shop_settings`; senza impostazioni non si mostrano stato, orari né la data della prossima prenotazione.
6. Opzione B, decisa dall'utente: nessun vincolo nel database, perché i test 18 e 19 e il motore usano fasce fino alle 24:00. La migrazione `20261006100000_shop_opening_hours_until_midnight.sql` fa sì che `shop_opening_hours()` restituisca `24:00` invece di `00:00`. `openingStatus` tratta "24:00" come la mezzanotte del giorno dopo, e la home mostra "24:00" anche nello stato. Test in `supabase/tests/25_review_fixes_fetta8a.test.sql` e `tests/acceptance/theme-review-fixes.test.ts`.
7. Migrazione `20261006100100_shop_closures_for_day.sql`: il calcolo del giorno locale passa nella funzione interna `shop_closures_on_local_day(p_at)` (definer, nessun grant), usata da `shop_closures_today()` con `now()`. Test sui giorni di 25 ore (25/10/2026) e di 23 ore (28/03/2027).
8. Token `--ink-on-marble` (`text-on-marble`) per testo e mosca sul marmo; `--marble-vein` resta per venature e scia.
9. `.mcp.json`: `@playwright/mcp@0.0.83`.
10. Test di `dayParts` e `formatLongDate` in `tests/acceptance/theme-review-fixes.test.ts`.
11. Annotata, non applicata: `generateMetadata` nel root layout legge le impostazioni con i cookie, quindi tutte le route sono dinamiche (lo erano già quasi tutte per l'autenticazione). Da rivedere se servirà il rendering statico, ad esempio con un titolo letto senza sessione.

## Ripiego del login con il template email predefinito (2026-10-06)

**Motivo**: in produzione, senza SMTP proprio, Supabase usa il template predefinito. Il link torna all'app con `?code=` (PKCE), che non era gestito: il cliente tornava in home senza sessione.

**Fatto**
- `src/lib/auth/email-fallback.ts` (`emailLinkFallback`, logica pura): nel proxy `/?code=` e `/auth/confirm?code=` vanno a `/auth/callback`, mentre `error`/`error_code` portano a `/accedi?errore=link` (l'errore vince sul codice).
- `src/app/auth/callback/route.ts`: scambio con `exchangeCodeForSession`, cookie in sospeso finché il ruolo non è verificato. Cliente: stessa destinazione del flusso principale. Staff: revoca della sola sessione nuova e `/admin/login`. Codice non valido: `/accedi?errore=link`.
- `src/components/auth/email-link-error.tsx`, nel layout dell'area clienti: errori nel fragment → `/accedi?errore=link`.
- Documentazione: ADR 002 (eccezione approvata a `requireRole` per il callback), `DEPLOY.md` §5, `GO-LIVE.md` §3.
- Test di spec-qa (commit `c2d1248`): `tests/acceptance/auth-code-fallback.test.ts` (22), `tests/e2e/auth-code-fallback.spec.ts` (6).

**Verifiche**
- Il link predefinito si simula aprendo `/auth/v1/verify?token=<token_hash>` con il token letto da Mailpit. Per un indirizzo nuovo il tipo è `signup`, per uno esistente `magiclink`.
- GoTrue mette l'errore di un link già usato sia nella query sia nel fragment.
- Staff, sessione revocata solo per il link (verificata su `auth.sessions`):
  - dopo il link dello staff il numero di sessioni del barbiere non cambia;
  - con una sessione aperta con la password nello stesso browser, quella resta intatta (refresh token valido) e si resta su `/admin`.

**Decisioni**: il barbiere demo è lo staff di prova, perché l'email dell'admin è usata da altri test in parallelo. Un `?code=` vuoto va comunque a `/auth/callback`, che lo rifiuta. Un cliente già loggato che apre un link scaduto finisce in home senza messaggio. Uno staff con una sessione aperta che apre il link resta su `/admin`.

**Limiti** (finché manca l'SMTP): il link vale solo nel browser della richiesta e solo l'ultimo richiesto (un solo `code_verifier` per browser); si consuma all'apertura (gli scanner della posta possono invalidarlo).
**Test esistente modificato** (approvato dall'utente): `tests/acceptance/auth.test.ts`, "nessun route handler GET esegue signOut". Ha un'eccezione stretta solo per `src/app/auth/callback/route.ts`, dove un nuovo test verifica che ogni `signOut` usi `scope: "local"`.

**Esiti**: lint ok, typecheck ok, Vitest 1292/1292, pgTAP 1090/1090, Playwright 88/88. Review: nessun bloccante (open redirect, login forzato e cookie verificati).

**Migliorie dalla review** (1, 2, 3 e 7 applicate su richiesta dell'utente nel commit "fix: review ripiego login"; 4, 5 e 6 annotate; la review è chiusa)
1. Con `/auth/confirm?code=…&next=<origin>/?n=…` la destinazione si perde (il callback legge `n` solo dalla query). Oggi il ritorno è sempre `/?n=`: caso marginale.
2. Ramo staff: l'errore di `signOut` (revoca fallita) non viene registrato.
3. Limite da documentare: vale solo l'ultimo link richiesto da quel browser (un solo `code_verifier`).
4. I cookie `…-flow-<id>-code-verifier` restano fino alla scadenza (vale anche per il flusso principale).
5. Solo verificati a mano, senza e2e: staff con sessione già aperta che apre il link, pulizia del verifier, ramo senza profilo.
6. Errore solo nel fragment su `/auth/confirm` non intercettato: oggi GoTrue lo mette anche nella query, quindi lo gestisce il proxy.
7. Documentazione: GO-LIVE dice ancora "senza, il cliente torna sempre alla home"; in DEPLOY il punto "4bis." spezza l'elenco numerato.

**Come sono state applicate le migliorie 1, 2, 3 e 7** (commit "fix: review ripiego login")
1. `callbackDestination(url)` in `email-fallback.ts`: legge prima `next` (code arrivato su `/auth/confirm`), poi `n`, sempre attraverso `safeNextPath`. Test in `tests/acceptance/auth-fallback-review-fixes.test.ts`.
2. Nel ramo staff, se la revoca della sessione fallisce, l'errore va nel log; il redirect non cambia.
3. `DEPLOY.md` §5 e PROGRESS: vale solo l'ultimo link richiesto da quel browser.
7. `GO-LIVE.md` allineato al ripiego (la pagina di partenza si conserva con i Redirect URLs). In `DEPLOY.md` §5 il ripiego è il punto 5 e i successivi sono rinumerati.


## Fetta 8 – PWA e accesso dall'app installata

**Stato**: implementata, review in corso (un giro, nessun bloccante; migliorie M1–M6 da decidere con l'utente). Hash di partenza `342b2cc`, test di accettazione nel commit `d96835a`. Procede prima della fetta 7 (notifiche), su decisione dell'utente. Da fare: `db push` della migrazione `20261010090000`, configurazione del cloud (GO-LIVE §3) e prova a mano su iPhone e Android (`docs/DEPLOY.md` §8).

**Fatto**
- Login con codice a 6 cifre (ADR 009):
  - i template email contengono il codice (`{{ .Token }}`) e il link; codice e link scadono dopo 15 minuti (`otp_expiry = 900`);
  - in `/accedi`, dopo l'invio, c'è il campo del codice (`inputmode="numeric"`, `autocomplete="one-time-code"`), con "Invia di nuovo" dopo 60 s e "Usa un'altra email";
  - la server action `verifyLoginCode` apre la sessione dove il codice viene digitato, con le stesse regole del link (solo clienti, stesse destinazioni).
- Limite dei tentativi: migrazione `20261010090000_login_code_attempts.sql`.
  - Tabella con l'hash sha256 dell'email normalizzata e funzioni `login_code_check/register_failure/reset/clear`, eseguibili solo dalla `service_role` e chiamate da `src/lib/auth/login-code.ts` (server-only).
  - 5 errori per codice (si azzerano con un nuovo codice, solo se l'email è partita), 10 all'ora per email (finestra fissa), entrambi azzerati da un login riuscito.
  - Un 429 di GoTrue non conta come errore.
- App installabile:
  - `manifest.ts` con nome dalle impostazioni e nome breve = prima parola;
  - icone da `next/og` con la mosca del tema (`icon.tsx` a 192 e 512 px, la 512 anche maskable; `apple-icon.tsx` a 180 px);
  - `appIdentity` nel tema;
  - `appleWebApp` e `themeColor` nel layout.
- Installazione: banner in home (istruzioni iOS, oppure "Installa" con `beforeinstallprompt`; "Non ora" per sempre su quel dispositivo, mai in standalone) e voce "Installa l'app" nel profilo.
- Service worker (`public/sw.js`, solo in produzione):
  - cache-first per `/_next/static/` e le icone; navigazioni in rete, con la pagina `/offline` statica come ripiego;
  - interruttore d'emergenza `public/sw-kill-switch.js`;
  - `Cache-Control: no-store` su `/sw.js`.
- Documentazione: ADR 009, GO-LIVE §3 e §4, DEPLOY §8 (verifica dell'app installata e interruttore), SPEC §5.5 e §5.6. In locale `token_verifications = 300` per gli e2e.
- Test (commit `d96835a`):
  - pgTAP `27_login_code_attempts` (60);
  - Vitest `login-code.test.ts` (51) e `pwa.test.ts` (48);
  - e2e `login-code.spec.ts` (4) e `pwa.spec.ts` (6);
  - eccezione in `admin-access.test.ts` per `login-code.ts`, approvata dall'utente.

**Esiti**: lint ok, typecheck ok, Vitest 1472/1472, pgTAP 1169/1169, Playwright 102/102 (dev, 4 worker, con `SUPABASE_SERVICE_ROLE_KEY`), `npm run build` ok.

Verifica sulla build di produzione (Playwright MCP, 390 px):
- service worker attivo, in cache solo `/offline`, file `/_next/static/` e icone;
- senza rete compare "Sei offline", e "Riprova" torna alla home;
- banner con user agent iPhone, modulo del codice, icona a 512 px.

L'interruttore d'emergenza è verificato una volta su un Chromium pulito (script separato): il worker si deregistra e le cache si svuotano in circa 1,5 s. In Playwright MCP il nuovo worker restava in attesa, perché la sessione MCP si aggancia ai worker.

**Decisioni** (approvate dall'utente)
- Si procede prima della fetta 7.
- La rifinitura UI si limita a quello che emerge dalla prova in standalone.
- Un solo messaggio per codice sbagliato o scaduto, con i tentativi rimasti.
- Dopo un login riuscito si azzerano entrambi i contatori.
- La finestra oraria è fissa.
- Il reset avviene solo se l'email è partita.
- Il 429 non conta come errore.
- Lo scope `/` include l'admin.
- Icone generate da `next/og`.
- La voce nel profilo resta visibile anche dove il browser non propone l'installazione e mostra istruzioni generiche: lo richiede l'e2e, che la cerca su Chromium desktop.

**Problemi trovati durante l'implementazione**
- Le modifiche fatte con script Python hanno convertito i fine riga in CRLF (il test LF di `it.ts` è fallito); corretto.
- `/offline` è statica, quindi il titolo della pagina viene dal nome del negozio al momento della build.
- Il pulsante "Invia di nuovo" non mostra il conto alla rovescia: un numero nel testo renderebbe instabile il confronto anti-enumerazione degli e2e.

**Review chiusa** (commit "fix: review fetta 8", 2026-10-10)
- M1 non applicata: il limite si può superare di qualche tentativo con richieste parallele, perché controllo e conteggio sono separati. Documentata insieme a M2.
- M2 documentata in ADR 009 e GO-LIVE §3: il contatore è una difesa in più e si aggira chiamando Supabase direttamente. Le protezioni vere sono il limite per IP di Supabase, la scadenza di 15 minuti e lo spazio di 10^6 codici.
- M3: in DEPLOY §7 la regola del firewall Vercel copre `/prenota` OPPURE `/accedi`, cioè una regola con due condizioni, perché il piano Hobby ne ammette una sola. Voce aggiornata anche in GO-LIVE §4.
- M4: nuovo stato `sessionFailed` di `verifyLoginCode` con messaggio dedicato (`it.auth.loginCode.sessionFailed`), che compare quando il codice è giusto ma la sessione non si apre. Non conta come tentativo.
- M5: `appIdentity` ora contiene solo i colori. Il disegno è `appIconSvg` (`src/themes/mosca/app-icon.ts`) e diventa data URI solo in `src/lib/pwa/icons.ts`, che è server-only. Verificato sulla build: prima il disegno era in un chunk client, ora si trova solo nei chunk del server.
- M6: la cache del service worker ha la versione del deploy (`VERCEL_GIT_COMMIT_SHA`, poi `VERCEL_DEPLOYMENT_ID`, poi `local`). La calcola `next.config.ts` (`env.SW_VERSION`), la passa `register-sw.tsx` come `/sw.js?v=` e `sw.js` la legge dal proprio URL. Non c'è più una costante `VERSION` da aggiornare a mano.
  - Verificato su una build con un commit finto: il worker `/sw.js?v=abc1234def` usa la cache `barber-shop-static-abc1234def`.
- Test di regressione in `tests/acceptance/pwa-review-fixes.test.ts` (9 test).
- Controlli dopo il fix:
  - lint e typecheck ok;
  - Vitest 1481/1481;
  - pgTAP 1169/1169;
  - Playwright 102/102;
  - build ok.

**CI rossa dopo il push** (2026-10-10, commit "fix: invio email rifiutato da Supabase (CI fetta 8)")
- **Sintomo**: `login-code.spec.ts`, "un nuovo codice fa ripartire". La seconda email non arrivava. Si riproduceva in locale con `CI=true`, cioè sulla build di produzione.
- **Causa**: dai log di Supabase Auth, la seconda richiesta arrivava 0,87 s dopo la prima, perché sulla build di produzione i cinque codici sbagliati si provano in meno di un secondo. Con `max_frequency = "1s"` Supabase la rifiutava con `429 over_email_send_rate_limit`. Il tetto orario (`email_sent`) non è mai scattato.
- **Configurazione**: in `supabase/config.toml`, che vale solo in locale e in CI, ora c'è `max_frequency = "1ms"`. `"0s"` non funziona, perché Supabase lo tratta come il valore predefinito di 60 s (verificato). In produzione resta la dashboard a 60 s: aggiunta la voce in GO-LIVE §3.
- **Messaggio all'utente**: `requestMagicLink` non risponde più "inviato" quando l'email non parte.
  - Con un 429 risponde `rateLimited` ("aspetta qualche secondo e riprova").
  - Con altri errori risponde `error` ("invio non riuscito").
  - In entrambi i casi il campo del codice non compare e il contatore non si azzera.
- **Enumerazione**: il rischio legato al 429 è accettato e annotato in ADR 009.
- **Test**: `tests/acceptance/login-send-errors.test.ts` (6 test).
- **Controlli**:
  - lint e typecheck ok;
  - Vitest 1487/1487;
  - pgTAP 1169/1169;
  - Playwright con `CI=true` (build di produzione) 102/102.

**Prova su iPhone: schermata d'errore offline** (2026-10-11, commit "fix: pagina offline statica senza JavaScript")
- **Sintomo**: con l'app installata in modalità aereo compariva "Sei offline" e, dopo un attimo, la schermata di Next "This page couldn't load".
- **Causa**, riprodotta sulla build di produzione con Chromium: la pagina `/offline`, salvata all'installazione solo come HTML, si idratava e chiedeva i propri script (`next/link`), che non erano in cache. Il caricamento falliva (`Failed to load chunk`) e Next mostrava la sua schermata d'errore. Dopo il passaggio offline non partiva nessuna richiesta dei dati della route `/`.
- **Correzione**: `src/app/offline/page.tsx` è sostituita da `src/app/offline/route.ts`, HTML statico generato alla build senza JavaScript dell'app.
  - Gli stili sono inline, con le variabili del `theme.css` del tema attivo (`themeName` in `active.ts`).
  - Font di sistema; "Riprova" ricarica la pagina.
  - Indirizzo e service worker invariati.
  - Leggere il file con un percorso costruito a runtime faceva includere a Turbopack l'intero progetto nel pacchetto del server. Il percorso ora è limitato a `src/themes/`.
- **Test di accettazione**: `tests/acceptance/pwa.test.ts` ora legge `route.ts` al posto di `page.tsx`, con la stessa verifica (autorizzato dall'utente).
- **Nuovi test**:
  - `tests/acceptance/offline-static.test.ts` (4 test);
  - `tests/e2e/offline.spec.ts`: il worker ha in cache solo `/offline`, poi si va offline e si naviga a `/`. La pagina resta visibile per 4 s, senza errori in console né schermata d'errore. Fallisce con la vecchia pagina (verificato) e passa sulla build di produzione e con il server di sviluppo.

**Collegamenti tra i due accessi** (2026-10-11, commit "feat: collegamenti tra accesso cliente e accesso staff")
- "Accesso staff" (link a `/admin/login`) compare:
  - in fondo a `/accedi`, dopo il modulo;
  - nel piè di pagina della home, in un `<footer>` fuori da `<main>`, così è un vero piè di pagina anche per l'accessibilità.
- "Sei un cliente? Accedi qui" (link a `/accedi`) compare sotto il modulo di `/admin/login`.
- Testi in `it.auth.customerLogin.staffLink` e `it.auth.staffLogin.customerLink`. Stile in `secondaryLinkClass`: collegamento discreto, tap target da 44 px.
- **E2e**: `tests/e2e/login-links.spec.ts` (3 test).
- **Controlli** dopo i due commit:
  - lint e typecheck ok;
  - Vitest 1491/1491;
  - pgTAP 1169/1169;
  - Playwright 106/106, sia con `CI=true` (build di produzione) sia con il server di sviluppo.

**Bug in produzione su Safari iOS: sessione revocata ancora nei cookie** (2026-10-11)
- **Sintomo**: navigazione normale, header con "Accedi". Il tocco su "Accedi" non faceva nulla, "Prenota" ricaricava la home e `/admin/login` portava alla home. In navigazione privata funzionava.
- **Riproduzione su produzione** con Playwright (WebKit con profilo iPhone, Chromium con profilo Pixel), con e senza service worker, in contesto pulito: nessun problema. Il service worker e Safari non c'entrano.
- **Causa**: il proxy usa `getClaims()`, che verifica il JWT in locale, e vedeva un cliente. Le pagine usano `getUser()`, e Supabase rispondeva `403 session_not_found`. I log di Auth di produzione mostrano 48 `session_not_found` tra le 22:22 e le 22:39 UTC del 2026-10-10, poco dopo un `/logout`.
  - Ipotesi sull'origine, non verificata: l'app installata su iOS parte con una copia dei cookie di Safari, e un logout dall'app revoca anche la sessione rimasta in Safari.
  - In locale i tre sintomi si riproducono cancellando la sessione lato Supabase.
- **Correzione**: `resolveAccess` (`src/lib/auth/stale-session.ts`) conferma la sessione con `getUser()` solo quando il proxy sta per fare un redirect dovuto all'utente loggato.
  - Se la sessione non esiste più (`AuthSessionMissingError`, cioè quello che supabase-js restituisce davvero, oppure `session_not_found`, 401 o 403), il proxy cancella i cookie `sb-…-auth-token` e decide come per un anonimo.
  - Con un errore di rete resta la decisione di partenza.
  - Annotato in ADR 002.
- **Test**:
  - `tests/acceptance/stale-session.test.ts` (28 test);
  - `tests/e2e/stale-session.spec.ts`: login con il codice, revoca della sola sessione con la service role, poi controllo di "Accedi", "Prenota", `/admin/login` e dei cookie. Senza la correzione falliva su "Accedi", che restava sulla home.
- **Domini**: il dominio pubblico di produzione è `barber-shop-jade-alpha.vercel.app`, ora scritto in DEPLOY §2 e §5 e in GO-LIVE §4. Gli URL del team, come `barber-shop-gio-s1.vercel.app` usato dal telefono, sono dietro la protezione dei deploy di Vercel.

**Banner di installazione solo su mobile** (2026-10-11, commit "fix: banner di installazione solo su mobile")
- **Sintomo**: il banner "L'app sul tuo telefono" compariva anche su Chrome ed Edge desktop, che inviano `beforeinstallprompt`.
- **Correzione** (`src/components/pwa/install-banner.tsx`): il banner compare solo se `matchMedia` riconosce un telefono, cioè puntatore principale touch e viewport da telefono (larghezza fino a 767 px, o altezza fino a 500 px in orizzontale); lo user agent non conta. La voce del profilo resta su ogni dispositivo: sul computer dice "Installa l'app sul computer" (`it.pwa.install.profileEntryDesktop`) e le istruzioni sono generiche (`desktopInstructions`); su iOS restano le istruzioni iOS.
- **Documenti**: SPEC §5.6 e ADR 009 aggiornati (approvato dall'utente).
- **Test**: in `tests/e2e/pwa.spec.ts`, nuovo "con beforeinstallprompt il banner non compare" su un contesto desktop (1280 px, senza touch, user agent di Chrome per Windows). Il test controlla prima che l'evento arrivi al componente (`defaultPrevented`), poi l'assenza del banner. Fallisce con il vecchio componente (verificato). I test del banner su iPhone e Android girano già con il profilo Pixel 7 (touch, viewport da telefono) e restano invariati. Autorizzato dall'utente.
- **Controlli**: lint e typecheck ok, Vitest 1642/1642, Playwright 111/111 (pgTAP invariato: nessuna modifica al database).

## Fetta 9a – Statistiche

**Stato**: completata, review chiusa (un giro, nessun bloccante; migliorie 1–7 applicate su richiesta dell'utente, la 8 annotata). Hash di partenza `5902d18`; SPEC aggiornata nel commit `52d9043` (§11 divisa in 9a e 9b, §6.9 con le definizioni), test di accettazione nel commit `7310c2d`. Procede prima della fetta 7, su decisione dell'utente. Migrazione `20261011090000` applicata a Supabase cloud (`db push` dell'utente, 2026-10-11, senza errori); CI da verificare dopo il push di `c32bc40`.

**Fatto**
- Migrazione `20261011090000_admin_booking_stats.sql`: `admin_booking_stats(p_from, p_to, p_exclude_demo)`, `security definer`, solo admin (42501, prima del controllo sul periodo), periodo massimo 366 giorni (22023). Restituisce un `jsonb` di gruppi per giorno locale, barbiere, servizio, stato e "già iniziata". Execute solo ad `authenticated`, revocato anche alla `service_role`.
- Logica pura in `src/lib/stats/`: `aggregate.ts` (`buildStats`), `dates.ts` (settimane e mesi, riusa `src/lib/domain/local-time.ts`), `format.ts` (`formatRate`, `bucketLabel`), `periods.ts` (scorciatoie), `schemas.ts` (parametri della pagina, non fallisce mai).
- Lettura in `src/lib/db/stats.ts` (client della richiesta, colonne esplicite, jsonb validato con Zod).
- Pagina `src/app/admin/(panel)/statistiche/page.tsx`: modulo GET (periodo, scorciatoie, raggruppamento, barbiere, "Escludi prenotazioni demo"), riquadri dei totali con `data-stat`, grafico a barre HTML/CSS (`src/components/admin/stats/trend-chart.tsx`, `aria-hidden`, dettaglio al passaggio del mouse), tabelle andamento, per barbiere e per servizio (`stats-tables.tsx`). Testi in `it.admin.stats`.
- ADR 010.
- Test (commit `7310c2d`): pgTAP `28_admin_booking_stats` (42), Vitest `stats.test.ts` (123), e2e `admin-stats.spec.ts` (3); `/admin/statistiche` aggiunta al warm-up di `global-setup.ts`.

**Esiti**: lint ok, typecheck ok, Vitest 1642/1642, pgTAP 1211/1211, Playwright 110/110 (dev, con `SUPABASE_SERVICE_ROLE_KEY`). Verifica visiva con Playwright MCP a 1280 e 390 px su dati temporanei (poi cancellati): a 390 px corretti il "€" a capo nell'incasso e la cella vuota del quinto riquadro; nessuno scroll orizzontale della pagina.

**Decisioni** (approvate dall'utente)
- Prenotazioni = confirmed + completed + no_show; cancellazioni a parte (cliente e negozio).
- Incasso stimato = `price_cents` di completed + confirmed; riquadro "Passate da chiudere" (già iniziate, ancora confirmed).
- Tasso di no-show = no_show / non cancellate già iniziate, "—" se nessuna.
- Giorno locale di `starts_at`; settimane da lunedì; periodo predefinito il mese corrente, massimo 366 giorni; "Ultimi 3 mesi" = mesi di calendario.
- Solo admin: il barbiere non vede nemmeno le proprie.
- Demo: `bookings.notes` uguale a "Prenotazione demo" (senza spazi, tab e a capo ai bordi, senza distinguere maiuscole); contano normalmente, la casella spenta di base le esclude.
- Barbieri e servizi attivi senza prenotazioni nel periodo compaiono a zero; i disattivati solo se hanno prenotazioni.
- Grafico a barre semplice in HTML/CSS senza librerie, con la tabella sotto come versione accessibile.
- `service_role` senza execute; controllo del ruolo prima del periodo; lettura in `src/lib/db/stats.ts`.

**Correzioni ai test di accettazione** (approvate dall'utente)
- Prima del commit: spec-qa ha adeguato i test alle decisioni sui punti aperti (righe a zero, tab e a capo nella nota demo, `service_role`, ordine dei controlli).
- Dopo il commit: in `admin-stats.spec.ts` le righe di Luca e Taglio si cercano per nome esatto (`has: getByText(nome, { exact: true })`): "Taglio" corrispondeva anche a "Taglio + Barba" e "Taglio bambino", presenti a zero.

**Problemi trovati durante l'implementazione**
- `npx supabase gen types` da solo produce un file non formattato: usare `npm run db:types`.
- Il primo giro degli e2e è fallito (55) per l'ambiente: mancava `SUPABASE_SERVICE_ROLE_KEY` e Playwright riusava il server di sviluppo lasciato acceso dalla verifica visiva.

**Migliorie della review** (1–7 applicate su richiesta dell'utente prima del commit; la review è chiusa)
1. Nuovo indice `bookings_starts_at_idx` nella migrazione `20261011090000`, commento allineato.
2. `statistiche/error.tsx` come nelle altre sezioni (impostazioni non leggibili → messaggio dell'app).
3. Un solo client Supabase per richiesta, passato a `loadStats`.
4. Se il caricamento fallisce, il barbiere scelto resta in un campo nascosto e "Applica" lo conserva.
5. Rimossi il segnaposto `src/app/admin/(panel)/[section]/page.tsx` (ogni sezione ha la sua pagina; gli slug sconosciuti danno il 404 di Next) e `it.admin.comingSoon`.
6. `buildStats` in una sola passata sui gruppi (mappa giorno → bucket).
7. `sum(price_cents)` in `bigint`.

**Esiti dopo le migliorie**: lint ok, typecheck ok (dopo aver cancellato i tipi generati in `.next/`, che citavano ancora `[section]`), Vitest 1642/1642, pgTAP 1211/1211, Playwright 110/110.

**Miglioria annotata, non applicata**
8. Il dettaglio delle barre si vede solo con il mouse: accettabile, la tabella dell'andamento è l'alternativa accessibile e il grafico è `aria-hidden`.

**Testi e elenco "Da aggiornare"** (2026-10-11, commit "fix: testi e elenco Da aggiornare nelle statistiche", richiesta dell'utente)
- Il riquadro "Passate da chiudere" diventa "Da aggiornare", con il sottotitolo "Appuntamenti già passati non ancora segnati come completati o no-show". Se è più di zero, tutto il riquadro (bordo nero, come ciò che si tocca) porta all'elenco.
- Elenco `/admin/statistiche/da-aggiornare`, solo admin (`requireRole`), con gli stessi filtri (periodo, barbiere, demo):
  - colonne data, ora, barbiere, cliente, servizio, dalla più vecchia, al massimo 200 righe;
  - la data apre il dettaglio nel calendario, dove si cambia lo stato. In una prima versione c'era una colonna "Apri" in fondo, che a 390 px finiva fuori dallo schermo: sostituita dal collegamento sulla data.
- Lettura `getBookingsToUpdate` in `src/lib/db/stats.ts` (RLS di `bookings`, stessa regola del riquadro). Nuovi moduli puri `src/lib/stats/demo.ts` (`isDemoNote`, uguale alla funzione SQL) e `src/lib/stats/paths.ts` (percorsi condivisi delle due pagine).
- Testi della pagina con le parole del titolare:
  - "Appuntamenti" al posto di "Prenotazioni", con il sottotitolo "Senza i cancellati";
  - "Clienti non presentati" al posto di "Tasso di no-show";
  - "Cancellati" al posto di "Cancellazioni";
  - "Mostra per" al posto di "Raggruppa per";
  - colonne "Non presentati" e "% non presentati".
  - "Escludi prenotazioni demo" resta com'è: il testo è fissato dai test di accettazione.
- SPEC §6.9 e ADR 010 aggiornati.
- **Test**:
  - in `tests/acceptance/stats.test.ts` cambia solo il testo atteso di `totals.toClose` ("Da aggiornare"), autorizzato dall'utente;
  - nuovi `tests/acceptance/stats-to-update.test.ts` (12) e `tests/e2e/admin-stats-to-update.spec.ts` (3): riquadro ed elenco con il filtro demo, riquadro a zero senza collegamento, barbiere rimandato a `/admin`.
- Verifica visiva con Playwright MCP a 1280 e 390 px su dati temporanei, poi cancellati.
- **Controlli**: lint e typecheck ok, Vitest 1654/1654, pgTAP 1211/1211, Playwright 114/114.

## Fetta 8b – Rifinitura estetica (tema Mosca)

**Stato**: completata, review chiusa (un giro, nessun bloccante; migliorie 1–8 applicate su richiesta dell'utente nel commit "fix: review fetta 8b"). Hash di partenza `312f4c4`, implementazione nel commit `34ee58a`. Test di accettazione nel commit `20d7fa8` (con SPEC §5.1, §5.2, §11, DESIGN, DEPLOY §8 e GO-LIVE) e `f81656e` (`calendarUidHost` separato). Nessuna migrazione. Resta la prova a mano su iPhone di "Aggiungi al calendario" (`docs/DEPLOY.md` §8 punto 4).

**Fatto**
- Home: prossima prenotazione come biglietto (`src/components/booking/next-booking-ticket.tsx`): conto alla rovescia, data, ora grande, perforazione con tacche, "Gestisci". Senza prenotazione resta il blocco nero "Prossima prenotazione". "Prenota" con bordo doppio e Bodoni; doppio filetto sotto "Orari" e "Dove siamo".
- Listino (`/prenota`): "Il listino", "Scegli il servizio", mosca piccola; righe con linea puntinata, nome accessibile "nome, durata, prezzo", tra due doppi filetti.
- Barbieri (`/prenota/barbiere`): "Con chi?" con servizio e durata, "Nessuna preferenza" in un blocco nero con la mosca, griglia a due colonne di ritratti (foto in scala di grigi o riquadro tratteggiato con l'iniziale), prima riga della bio.
- Conferma: `/prenotazioni/[id]/confermata` sul marmo a schermo intero, scia con la mosca che atterra, "Ci vediamo …", data e ora, servizio, barbiere, negozio e indirizzo; azioni "Aggiungi al calendario", "Le mie prenotazioni", "Torna alla home". `createBooking` porta qui; il banner `?esito=confermata` è stato rimosso (resta quello della cancellazione).
- File `.ics`: route `/prenotazioni/[id]/calendario.ics` (`requireRole`, `getOwnBooking` con RLS, solo prenotazioni proprie confermate e future, altrimenti 404), builder puro `src/lib/booking/ics.ts`, `Content-Disposition: attachment`, `Cache-Control: private, no-store`.
- Logica pura: `src/lib/booking/countdown.ts` (`bookingCountdown`, `seeYouPhrase` con elisione "l'8", "l'11", "il 1°"), `src/lib/calendar/now-line.ts`, `firstBioLine`, `confirmationPath`/`calendarFilePath`, `isUpcoming` in `rules.ts` (riusata da `splitBookings`).
- Tema: nuovi export `EmptyMark`, `ConfirmationBackground`, `ConfirmationMark`, `calendarUidHost`. Movimento solo CSS dentro `prefers-reduced-motion: no-preference`: scia della home che si disegna (maschera con `pathLength`), atterraggio sulla conferma, orari in sequenza (`.appear-in`, ritardo limitato), pressione che inverte in nero (`active:`); `fly-pending` non più infinita (4 mezzi battiti).
- Stati vuoti: Le mie prenotazioni (mosca, testo, "Prenota"); admin solo testo e invito: giorno del calendario ("Nessun appuntamento in questo giorno", "Nuova prenotazione") ed elenco "Da aggiornare" ("Nessun appuntamento da aggiornare", "Torna alle statistiche").
- Admin, calendario giorno: linea dell'ora attuale (solo se il giorno è oggi nella timezone del negozio, aggiornata ogni minuto, minuti reali dall'inizio della griglia) e iniziale del barbiere nelle intestazioni.
- Test (spec-qa): `tests/acceptance/polish.test.ts`, `tests/acceptance/polish-static.test.ts`, `tests/e2e/booking-polish.spec.ts` (3); `tests/e2e/booking.spec.ts` adeguato (autorizzato): dopo la conferma pagina dedicata e poi "Le mie prenotazioni"; in home il titolo del biglietto.

**Esiti**: lint ok, typecheck ok, Vitest 1739/1739, Playwright 117/117 (dev, con `SUPABASE_SERVICE_ROLE_KEY`, rieseguito dopo le ultime correzioni). pgTAP non rieseguito: nessuna modifica al database. Verifica con Playwright MCP a 390 e 1280 px (home, listino, barbieri, orari, conferma, Le mie prenotazioni vuota e piena, giorno vuoto del calendario, "Da aggiornare" vuoto), a 390 px con movimento ridotto (nessuna animazione su home e conferma) e focus sul marmo (contorno bianco). Linea dell'ora verificata con l'orologio di Playwright. Dati temporanei cancellati.

**Decisioni** (approvate dall'utente)
- Nell'admin niente mosca: stati vuoti con solo testo e invito.
- "Ci vediamo": oggi, domani, nome del giorno entro 6 giorni, poi "il 24 ottobre" ("l'8", "l'11", "il 1° novembre").
- Prenotazione propria cancellata o già iniziata: la conferma rimanda a /prenotazioni; il `.ics` solo per confermate future (404 altrimenti).
- UID del `.ics` `<id>@mosca-barber-shop` da `calendarUidHost`, export a parte del tema (`appIdentity` resta solo colori, test M5 della fetta 8 invariato); `DTSTAMP` dall'ora della richiesta; `PRODID` generico, nessuna `DESCRIPTION`.
- `Content-Disposition: attachment`; se su iPhone il file finisse in File si passa a `inline` (l'utente ha già autorizzato a cambiare la sola asserzione di quell'header).
- Linea dell'ora: minuti reali dall'inizio della griglia, arrotondati per difetto.
- Marmo anche sulla schermata di conferma (DESIGN.md aggiornato).

**Problemi trovati durante l'implementazione**
- Già presente dalla fetta 8a: nella pagina degli orari il testo `sr-only` dei giorni senza orari usciva dalla striscia e allargava la pagina (scrollWidth 1773 px a 390). Corretto con `relative` sulle caselle dei giorni.
- Gli heredoc di Git Bash con `python -` dimezzano le barre rovesciate: per le regex con `\` usare Edit.
- `@/themes/active` non si importa in Vitest senza il mock di `next/font`: il test di `calendarUidHost` legge `src/themes/mosca/identity.ts`.

**Migliorie dalla review** (tutte applicate, vedi sotto)
1. Commento di `ColumnDropZone` rimasto sopra `EmptyDay` in `day-grid.tsx`.
2. `choiceClass` in `step-header.tsx` non è più usato.
3. Giorno vuoto: "Nuova prenotazione" compare due volte (barra della pagina e stato vuoto).
4. Pagina di conferma: se la lettura fallisce lancia un errore invece di mostrare `it.booking.errors.listLoad` con il link a "Le mie prenotazioni".
5. La route `.ics` non controlla `profileComplete` come la pagina (non è un problema di sicurezza).
6. "1°" e la regola dell'elisione scritti in `countdown.ts` invece che in `it.ts`.
7. `it.booking.duration.replace(...)` ripetuto: helper `formatDuration`.
8. Home: con prenotazione ma senza timezone compare "nessuna prenotazione" (caso già presente prima della fetta).

**Come sono state applicate le migliorie** (commit "fix: review fetta 8b")
1. Il commento di `ColumnDropZone` è tornato sopra la sua funzione.
2. Rimosso `choiceClass` da `step-header.tsx`.
3. Giorno vuoto del calendario: lo stato vuoto ha solo il testo; l'invito resta il pulsante "Nuova prenotazione" della pagina (rimossa la chiave `emptyDayCta`).
4. Pagina di conferma: se la lettura fallisce, messaggio `it.booking.confirmation.loadError` (`role="alert"`) con il link a "Le mie prenotazioni".
5. Pagina e route `.ics` usano la stessa lettura `loadOwnUpcomingBooking` (`src/lib/booking/own-booking.ts`: id, RLS, regola "in programma") e gli stessi controlli (`requireRole`, profilo completo); la route risponde 404 o 500, la pagina 404, redirect o messaggio.
6. "1°" e i giorni con l'articolo eliso in `it.booking.confirmation` (`firstOfMonth`, `elidedDays`).
7. `formatDuration(min)` in `src/lib/booking/format.ts`, usato da listino, barbieri e riepilogo.
8. Home: con una prenotazione ma senza timezone nelle impostazioni compare `it.home.nextBookingUnavailable` (`role="alert"`).

**Problemi trovati durante i controlli finali**
- Il primo test di `polish.test.ts` andava in timeout (5 s) nella suite completa: `countdown.ts` importava il barile `date-fns/locale`, con tutte le lingue. Ora `countdown.ts` e `src/lib/booking/format.ts` importano solo `date-fns/locale/it`.
- `npm run test:db` non si collegava: su `127.0.0.1:54322` era in ascolto anche Steam, che intercettava le connessioni al database locale. pgTAP eseguito file per file con `psql` dentro il container `supabase_db_barber-shop`. Risolto dopo la fetta (commit "chore: porta del DB locale libera da conflitti"): il database locale ora usa la porta 54332 (`[db] port` in `supabase/config.toml`); nessun file usava 54322 scritto a mano, CI e script leggono `DB_URL` da `supabase status`. `npm run test:db` di nuovo verde (1211/1211).

**Esiti dopo le migliorie**: lint ok, typecheck ok, Vitest 1739/1739 (due giri), pgTAP 1211/1211, Playwright 117/117.


## Fix calendario e assenze (2026-10-12)

- Calendario, vista giorno con "mostra cancellate": una cancellata nello stesso orario di una confermata ora sta in una corsia affiancata invece di restare coperta (`src/lib/calendar/overlap-layout.ts`; a 390 px corsia compatta con ora e nome); tabella delle assenze (e chiusure) su telefono con le colonne distanziate come Clienti e pulsanti da 44 px. Test: `calendar-overlap-layout.test.ts`, e2e `admin-calendar-cancelled-overlap` e `admin-period-table-mobile`. Gate: Vitest 1752/1752, Playwright 120/120.

## Fix tabella servizi su telefono (2026-10-13)

- Tabella dei servizi a 390 px con lo stesso schema delle assenze: colonne distanziate (prima "DurataPrezzo" attaccate e "15,00 €" su due righe), durata e prezzo su una riga, scorrimento orizzontale della sola tabella se serve, pulsanti Modifica/Su/Giù/Elimina da 44 px. Test: e2e `admin-services-mobile`.

## Fix sezione Clienti su telefono (2026-10-14)

- Elenco clienti sotto i 640 px come lista a righe invece della tabella a cinque colonne (l'email andava a capo lettera per lettera): nome, telefono, email su una riga troncata, etichette di blocco e no-show solo se servono; ogni riga è un link da almeno 44 px alla scheda. Da 640 px resta la tabella, con telefono ed email su una riga. Ricerca a tutta larghezza e paginazione con pulsanti da 44 px.
- Scheda cliente: dati con l'etichetta sopra il valore su telefono (niente più `break-all` sull'email) e storico a righe (data e prezzo, servizio e barbiere, stato). Test: e2e `admin-customers-mobile`.

## Fetta 8c – Vista settimana a griglia per singolo barbiere

**Stato**: completata, review chiusa (un giro, nessun bloccante; migliorie elencate sotto, non applicate). Hash di partenza `e96e554`, test di accettazione nel commit `84f3623`. Nessuna migrazione.

**Fatto**
- `src/lib/calendar/week-grid.ts` (puro): `weekGrid` (asse comune ai 7 giorni sull'orologio locale, stesso passo della vista giorno), `slotInstant`, `daySlots`, `isClosedDay`, `weekDropTarget`, `dayBlockPosition`.
- `loadWeekView`: prenotazioni, orari, assenze e chiusure con una query per tabella su [lunedì, lunedì successivo), in parallelo.
- Dalla vista giorno, senza cambiarne il comportamento: `grid-parts.tsx` (`BookingCard`, `DraggedCard`, `NowLine` con `locate`, `ColumnDropZone`, `placed`, `ROW_HEIGHT`) e `use-calendar-drag.ts` (sensori, blocco del click, anteprima, gestori di dnd-kit).
- `week-grid.tsx` (`WeekGridView`):
  - 7 colonne `[data-date]` (`data-closed`, `data-today`, `data-drop-target`);
  - righe libere come link precompilati; fuori orario, assenze e chiusure come sfondo ma cliccabili, come nella vista giorno;
  - "mostra cancellate" con `overlapLayout`; linea dell'ora solo nella colonna di oggi;
  - trascinamento su un altro giorno o orario, sempre per lo stesso barbiere;
  - contenitore `[data-week-scroll]` alto al massimo `100dvh - 6rem`, ore e intestazioni `sticky`, all'apertura scorre fino a oggi;
  - collision detection che non dà destinazione sopra le parti fisse o fuori dal contenitore.
- Rimossa la vecchia vista a elenco (`week-view.tsx`) e i testi `dayOff`, `noBookings`; nuovi `week.newAt`, `move.dropPreviewDay`. Pulsante "Nuova prenotazione" anche nella settimana.
- Documentazione: SPEC §6.1, §6.3, §11 (riga 8c); ADR 008 (sezione "Vista settimana").
- Test:
  - accettazione (commit `84f3623`): `calendar-week-grid.test.ts` (34), e2e `admin-calendar-week.spec.ts` (6);
  - implementazione: `calendar-week-block.test.ts` (3).

**Esiti**: lint ok, typecheck ok, Vitest 1789/1789, Playwright 126/126 ("eseguiti 126 su 126"). Screenshot con Playwright MCP a 1280 e 390 px controllati, con dati demo temporanei poi rimossi.

**Decisioni dell'utente**
- Nessuna opzione "Tutti i barbieri": la settimana è sempre per un barbiere e sempre a griglia. Nessun test esistente rimosso o modificato (nessuno descriveva la vecchia vista a elenco in modo incompatibile).
- Permessi, avvisi e rifiuti identici alla vista giorno; rifiutati solo slot occupato (server) e passato (client).
- Una query per tabella sulla settimana.
- Prenotazione oltre la mezzanotte ritagliata alle 24:00 nel giorno di inizio; settimana con sole prenotazioni: asse sulle sole prenotazioni; intestazione del giorno che mantiene "mostra cancellate"; ora ripetuta del ritorno all'ora solare = limite noto.
- Mobile: altezza in dvh, nessun `touch-action: none`, trascinamento solo dopo 250 ms.

**Da provare a mano su iPhone**
- Il dito scorre la griglia in orizzontale e in verticale senza afferrare le schede; la pagina non scorre di lato.
- Pressione di 250 ms su una scheda confermata futura: parte il trascinamento, senza menu del link né selezione del testo; rilascio su un altro giorno → "Prenotazione spostata."; "Annulla spostamento" la riporta.
- Trascinando verso il bordo destro o sinistro la griglia scorre e l'anteprima "giorno, ora" segue; rilasciando sopra la colonna delle ore o le intestazioni non succede nulla.
- All'apertura con data di oggi la colonna di oggi è accanto alle ore; tocco su uno slot libero apre la nuova prenotazione precompilata.

**Migliorie della review** (1, 3, 4, 7 applicate su richiesta dell'utente nel commit "refactor: rifiniture vista settimana"; 2 e 5 annotate come limiti noti nell'ADR 008; 6 lasciata, perché `past` è asserito dai test di accettazione)
1. Linea dell'ora della settimana senza test: estrarre `locate` in una funzione pura e testarla.
2. Nei giorni del cambio d'ora la linea dell'ora è sfasata di un'ora se l'asse parte prima delle 02:00–03:00 (minuti reali su asse a orologio): usare il minuto locale o annotarlo come limite noto.
3. Duplicazioni: `hhmm` in `week-grid.ts` e `week-grid.tsx`, `covers` in due varianti, link "Nuova prenotazione" ripetuto nei due rami della pagina.
4. Intestazioni dei giorni sotto i 44 px di tap target su telefono.
5. `cancelledCount` conta anche cancellate iniziate la domenica precedente e non mostrate; una confermata iniziata domenica sera non segna occupate le prime righe del lunedì (il server rifiuta comunque).
6. Campo `past` di `daySlots` non usato dall'interfaccia.
7. Riga vuota doppia in `week-grid.ts`.

**Come sono state applicate le migliorie**
1. Linea dell'ora della settimana: funzione pura `weekNowLine` in `week-grid.ts` (usa `nowLineMinutes`), test in `calendar-week-block.test.ts` (+2).
3. `hhmm` esportata da `week-grid.ts`; `covers` unica in `grid.ts` (vista giorno e settimana); pulsante `NewBookingLink` usato nei due rami della pagina.
4. Intestazioni dei giorni: area di tocco 44 px solo con `pointer: coarse` (pseudo-elemento larga quanto la colonna), aspetto invariato (intestazione sempre alta 29 px, verificato con Playwright MCP a 390 px in un contesto touch).
7. Riga vuota doppia rimossa.

**Esiti dopo le migliorie**: lint ok, typecheck ok, Vitest 1791/1791, Playwright 126/126 ("eseguiti 126 su 126"). Nessun test di accettazione modificato.

**Intestazioni dei giorni su touch** (richiesta dell'utente, commit "fix: intestazioni giorni 44 px su touch")
- Al posto dell'area di tocco che sbordava sulla prima riga: con `pointer: coarse` il link del giorno è un blocco alto 44 px (`py-3`), che occupa tutta l'intestazione; su desktop l'intestazione resta alta 29 px. Link `block` e non `flex`, perché `::first-letter` (maiuscola) non entra nei flex container.
- Nuovo e2e della 8c in `admin-calendar-week.spec.ts` (390 px, touch del Pixel 7): intestazione ≥ 44 px e sopra la prima riga; un tocco 3 px sotto il bordo alto della prima riga apre la nuova prenotazione di quello slot, e sulla prenotazione della prima riga ne apre il dettaglio, mai la vista giorno.
- ADR 008 aggiornato. Esiti: lint ok, typecheck ok, Vitest 1791/1791, Playwright 127/127 ("eseguiti 127 su 127").

**Vista settimana senza giorni di chiusura fissa** (richiesta dell'utente, commit "feat: vista settimana senza giorni di chiusura fissa")
- Una colonna non si disegna se il negozio non ha orari in quel giorno della settimana (`shop_opening_hours`, come la home), salvo prenotazioni da mostrare in quella data (non cancellate, o cancellate con "mostra cancellate"). Chiusure straordinarie invariate (colonna attenuata). Settimana, URL, navigazione e query restano lunedì–domenica; asse delle righe sui soli giorni disegnati. Funzioni pure `visibleWeekDays` e `initialWeekColumn` in `week-grid.ts`; con oggi nascosto il contenitore parte dalla prima colonna e la linea dell'ora non c'è.
- Test nuovi: `calendar-week-closed-days.test.ts` (Vitest), e2e `admin-calendar-week-closed-days.spec.ts` (5 colonne martedì–sabato senza scorrimento a 1280 px; la prenotazione di lunedì fa comparire il lunedì).
- Test di accettazione della 8c adattati con l'ok dell'utente (`admin-calendar-week.spec.ts`): 5 colonne invece di 7 e niente slot del lunedì nel primo caso; nel trascinamento fuori orario una prenotazione di lunedì nel setup rende visibile la colonna di arrivo (lunedì 11:15 come prima); nel caso delle chiusure il controllo "non chiuso" solo su mercoledì e venerdì; nel caso da telefono tolte le asserzioni che dipendono dal giorno in cui gira (oggi visibile all'apertura), coperte da Vitest perché gli e2e non possono fissare "adesso" lato server; intestazione fissa verificata sull'ultima colonna disegnata.
- SPEC §6.1 e §11 (riga 8c), ADR 008 aggiornati. Verificato con Playwright MCP a 1280 e 390 px (settimana corrente, oggi lunedì nascosto: 5 colonne, nessuno scorrimento a 1280 px, partenza dalla prima colonna).
- Esiti: lint ok, typecheck ok, Vitest 1800/1800; Playwright 129/129 ("eseguiti 129 su 129": nessun fallito, instabile o saltato). I 2 test in più rispetto al giro delle 14:20 (127/127) sono quelli di `admin-calendar-week-closed-days.spec.ts`.
- Un primo giro completo dava 116 passati, 10 falliti e 3 non eseguiti (clienti, account staff, login con codice, sessione revocata; `admin-settings` non partito): `SUPABASE_SERVICE_ROLE_KEY` mancava in `.env.local`, falliva allo stesso modo anche su `main`. Aggiunta la chiave, la suite è verde.

## Fetta 8d – Ritratti dei barbieri

**Stato**: completata, review chiusa (nessun bloccante; migliorie elencate sotto, non applicate). Hash di partenza `8926a01`; `.gitignore` nel commit `c47184b`, test di accettazione nel commit `8ce1218`. Fetta fuori dal piano originale, aggiunta a SPEC §3.3 e §11. Migrazione `20261016090000_barber_photos`. Resta la prova a mano da iPhone (galleria e fotocamera).

**Cosa è stato fatto**
- `barbers.photo_url` eliminata; `barbers.photo_path` con check `barbers_photo_path_format` (`<id>/<32 hex>.webp`, prefisso legato all'id), grant di select di colonna ad `anon` e `authenticated`.
- Bucket `barber-photos` pubblico in lettura, 1 MB, solo `image/webp`; policy su `storage.objects` solo admin e solo su questo bucket. Nessun `alter` sulle tabelle di `storage`.
- Admin → Barbieri → scheda: sezione "Ritratto" con anteprima, caricamento/sostituzione e "Rimuovi" (con conferma). Il campo URL della foto non c'è più.
- Browser: decodifica con `<img>`, ritaglio al centro 512×512, WebP 0,85 con ripiego JPEG 0,85 se il canvas non produce WebP (Safari iOS), funzione pura `encodePortrait`. File non decodificabile → errore senza invio.
- Server (`uploadBarberPhoto`, `removeBarberPhoto`): `requireRole('admin')`, Zod (WebP o JPEG, poi ≤ 1 MB), controllo dei primi byte e del formato letto da `sharp`, ricodifica sempre in WebP 512×512; percorso generato dal server; ordine upload → update → cancellazione del vecchio file. `deleteBarber` cancella anche il file.
- `BarberPortrait` condiviso: `<img>` con `loading="lazy"`, `decoding="async"`, alt "Ritratto di <nome>", iniziale come ripiego. Nessuna ottimizzazione di Next, nessun `remotePatterns`.
- `experimental.serverActions.bodySizeLimit = "2mb"`; `sharp` `^0.35.5` in `dependencies`.
- ADR 011, SPEC §3.3 e §11.

**Decisioni** (dettaglio nell'ADR 011)
- Barbiere inesistente al caricamento → `error` prima di caricare. Tipo non ammesso e peso oltre 1 MB insieme → `invalid` (il tipo si controlla prima). "Rimuovi" senza foto → `ok` senza toccare lo storage. Errore nel cancellare il file vecchio dopo un aggiornamento riuscito → resta `saved` (file orfano).
- Prefisso con id maiuscolo rifiutato (confronto testuale).
- Le illustrazioni della demo (`tmp-avatars/`, ignorata da git) si caricano dall'admin come le foto vere.

**Esiti** (dopo le migliorie e la correzione del test del venerdì): lint ok, typecheck ok, Vitest 1917/1917, pgTAP 1273/1273, Playwright 133/133 ("eseguiti 133 su 133"). Prima della correzione l'e2e completo dava 129 su 130 per il test del venerdì.

**Test del venerdì** (ok dell'utente a cambiare solo il setup, commit "test: prenotazione del test polish indipendente dal giorno"): in `tests/e2e/booking-polish.spec.ts:355` la prenotazione del cliente demo a oggi + 4 giorni passa dalle 10:00 alle 07:00. Di venerdì coincideva con quella del seed (martedì della settimana dopo alle 10:00, `bookings_customer_no_overlap`); il seed dà al cliente demo solo prenotazioni alle 10:00, quindi le 07:00 non collidono in nessun giorno. Verificato simulando i 7 giorni (10:00: collide solo il venerdì; 07:00: mai). Le asserzioni non cambiano.

**Migliorie della review**: applicate su richiesta dell'utente la 1, 2, 3, 4, 6 e 7; la 5 e la 8 annotate come limiti noti nell'ADR 011.
1. `sharp` con `limitInputPixels` 4096×4096.
2. Ridimensionamento nel browser con `try/finally`: il pulsante non resta su "Caricamento…".
3. L'URL del blob si revoca dopo il disegno sul canvas.
4. "Ritratto rimosso." dopo "Rimuovi"; "Ritratto aggiornato." nascosto quando la foto non c'è più.
6. `removePhotoFile` (modulo solo server `src/lib/barbers/photo-storage.ts`, usato anche da `deleteBarber`) controlla il percorso con `isBarberPhotoPath` prima di cancellare.
7. Codifica fallita nel browser → messaggio distinto `portraitEncodeFailed`.

**CI**: il workflow avvia Supabase senza `storage-api`. Migrazione e pgTAP passano lo stesso (verificato in locale con la stessa configurazione), ma l'e2e `barber-photo.spec.ts` fallisce ("name resolution failed" sull'upload). Il workflow non è stato modificato: decide l'utente.

**Caricamento più chiaro** (richiesta dell'utente dopo il merge, branch `fix/upload-ritratto`): il campo file nativo non sembrava cliccabile e "Carica foto" sembrava il caricamento ma serviva solo a confermare. Ora:
- un pulsante pieno "Scegli una foto" (etichetta del campo file, nascosto ma raggiungibile da tastiera, con il focus del tema) apre galleria o fotocamera;
- appena scelta, la foto si prepara nel browser e compare l'anteprima del quadrato che verrà salvato, con nome del file, "Salva ritratto" e "Annulla"; "Scegli una foto" passa a contorno;
- dopo il salvataggio l'anteprima lascia il posto al ritratto vero e a "Ritratto aggiornato."; un errore del server resta visibile accanto all'anteprima.
- Test di accettazione invariati (cambiano solo i testi delle chiavi `portraitLabel` e `portraitUpload`). Verificato con Playwright MCP a 390 px (vuoto, anteprima, salvato). Esiti: lint ok, typecheck ok, Vitest 1919/1919, Playwright 135/135.

**Migliorie della review (elenco originale)**
1. `sharp` senza `limitInputPixels`: un JPEG < 1 MB può dichiarare dimensioni enormi e far cadere la funzione. Proposta: `limitInputPixels: 4096 * 4096`.
2. Se il ridimensionamento nel browser lancia un'eccezione, il pulsante resta su "Caricamento…": `try/catch/finally`.
3. L'URL del blob si revoca prima di `drawImage`: spostarlo dopo, o usare `createImageBitmap`.
4. `portraitRemoved` non usato e "Ritratto aggiornato." resta a schermo dopo "Rimuovi".
5. Due caricamenti simultanei per lo stesso barbiere possono lasciare un file orfano: update condizionato sul percorso precedente.
6. `isBarberPhotoPath` usata solo dai test: riusarla prima di `storage.remove`.
7. Se `canvas.toBlob` fallisce per memoria, il messaggio "non è un'immagine leggibile" è fuorviante.
8. Senza `NEXT_PUBLIC_SUPABASE_URL`, `barberPhotoUrl` produce un URL relativo che dà 404: meglio `null` o un log.

## Fetta 8e – Prenotazione da telefono: servizio → quando → conferma

**Stato**: completata il 2026-10-16 (partenza da `fef894c`, test di accettazione in `c48ef75`). Review chiusa; manca la prova su iPhone.

**Decisioni (2026-10-16)**
- Il flusso passa da 4 a 3 schermate: servizio → "Quando?" (`/prenota/quando`) → riepilogo; regole in SPEC §5.2.
- "Primo libero" con più barbieri liberi al primo orario: il preferito (URL, poi ultimo appuntamento) se libero, altrimenti la regola di "qualsiasi" di SPEC §4, sul server.
- "Barbiere con cui ha prenotato più di recente" = barbiere dell'ultimo appuntamento già iniziato, escluse le cancellate.
- Giorno "chiuso" = nessun barbiere attivo del servizio ha ore di lavoro al netto di chiusure e assenze; altrimenti, senza orari, "senza posti" (attenuato, selezionabile).
- Sotto il nome del barbiere in "Quando?" la prima riga della bio (`firstBioLine`), piccola e grigia, su una riga con troncamento.
- Accesso come oggi (SPEC §5.3, §5.5): "Quando?" richiede login e profilo completo; il cliente bloccato vede l'avviso già lì.
- Punti aperti approvati: giorno richiesto "senza posti" senza nessun giorno con posti → stato vuoto; preferito dall'URL occupato → vince il barbiere dell'ultimo appuntamento se libero; barbieri senza orari di lavoro compaiono con "Nessun orario libero"; il "prossimo orario" si calcola solo per i barbieri pieni quel giorno; etichetta sr dei giorni con `formatDayLabel`; senza `giorno` l'URL si completa con `replaceState`; Tab rientra sul giorno selezionato; il riepilogo accetta ancora `barbiere=any`; nessun pulsante "Prenota di nuovo".

**Piano**
1. Motore (`src/lib/availability/`, puro): `dayStatuses`, `nextSlotByBarber`, `firstFree` (riusa `pickBarber`).
2. `src/lib/booking/when.ts` (puro): `orderBarbers`, `recentBarberId`, `splitByPeriod`, `initialDay`, `formatSlotTime`, `formatNextFree`.
3. Server action `fetchWhenDay` (Zod, una lettura di `availability_inputs`, in uscita solo orari e id dei barbieri); ultimo appuntamento letto dal server con la RLS.
4. Pagina `/prenota/quando` (prima giornata dal server, striscia sticky client con ←/→, cache dei giorni visti e prefetch del successivo, scheletro senza spostamenti) e sezioni per barbiere con ritratto, nome, bio e orari.
5. Listino → "Quando?", redirect di `/prenota/barbiere` e `/prenota/orario` (`legacyWhenUrl`), riepilogo con "Indietro"/"Cambia orario" verso "Quando?" sullo stesso giorno, "Passo N di 3", testi in `it.booking.when`.
6. ADR 012 sul passo "Quando?".
7. Test esistenti approvati: modificare `booking.spec.ts` (barbiere scelto; anonimo/bloccato), `booking-polish.spec.ts` (flusso 8b, bio su "Quando?"), `barber-photo.spec.ts` (ritratto su "Quando?"), `global-setup.ts`; rimuovere `booking.spec.ts` "Nessuna preferenza" e le due righe "Con chi?"/"Nessuna preferenza" di `polish.test.ts`.

**Dati: quanto si legge** (misurato in locale con il seed, servizio Taglio, 31 giorni)
- All'apertura il server legge una volta l'intero periodo prenotabile (`availability_inputs` da oggi a oggi + `max_horizon_days`): circa 18 KB e 17–27 ms fra database e server. Questi dati non arrivano al telefono: servono a stato dei giorni della striscia, giorno iniziale, orari del primo giorno e "prossimo orario libero".
- A ogni cambio di giorno `fetchWhenDay` rilegge dal giorno scelto alla fine del periodo (serve per il "prossimo orario libero" dei barbieri pieni): una sola lettura, stesso ordine di grandezza (≤ 18 KB, ~20 ms). Al telefono arriva solo il giorno: orari e id dei barbieri, pochi KB (misura reale da riportare a fine fetta). Rileggere il periodo invece del solo giorno costa pochi millisecondi e tiene il "prossimo orario" sempre aggiornato.

**Fatto**
- Motore: `dayStatuses`, `nextSlotByBarber`, `firstFree` (puri, in `src/lib/availability/`); `src/lib/booking/when.ts` con ordine dei barbieri, ultimo appuntamento, Mattina/Pomeriggio, giorno iniziale e formati.
- `getWhenOverview` (apertura, una lettura del periodo) e `fetchWhenDay` (cambio di giorno) in `src/lib/booking/availability*.ts`; in uscita solo orari e id dei barbieri.
- Pagina `/prenota/quando` con `WhenPicker`: striscia sticky con ←/→, "Primo libero", sezioni con ritratto, nome, prima riga della bio, orari a 4 colonne; giorni già visti in memoria e prefetch del successivo; scheletri con le righe del giorno precedente.
- Listino → "Quando?"; `/prenota/barbiere` e `/prenota/orario` fanno redirect; riepilogo "Passo 3 di 3" con "Indietro"/"Cambia orario" verso lo stesso giorno; `slot-picker.tsx` rimosso; testi "Con chi?"/"Nessuna preferenza" eliminati; ADR 012.
- Test: `booking-when.test.ts` (55), `booking-when.spec.ts` (5 e2e a 390 px), `booking-when-review-fixes.test.ts` (2); test esistenti modificati come approvato.
- Esito: lint, typecheck, Vitest (50 file, 1974 test) ed e2e (139) verdi. Verifica con Playwright MCP a 390 e 1280 px: striscia sticky, nessun overflow (375 = 375), redirect con "Il tuo barbiere".
- Misure reali in locale (dev): risposta di `fetchWhenDay` circa 2,9 KB (0,7 KB compressa), 90–110 ms; giorno già precaricato mostrato in circa 30 ms.

**Review**: due bloccanti corretti (risposte arrivate in ritardo che lasciavano gli scheletri; giorno "senza posti" richiesto senza giorni con posti → ora stato vuoto). La correzione delle risposte in ritardo non ha un test automatico.

**Problemi aperti**
- `availability_inputs` taglia gli intervalli a `now()`: oggi, dopo l'ultima fascia, risulta "chiuso" invece che "senza posti", e i conteggi del "Primo libero" di oggi non includono le prenotazioni già finite. Decisione 2026-10-16: accettato, nessuna migrazione; descritto in SPEC §5.2 e ADR 012.
- Migliorie della review: applicate il 2026-10-16 tutte tranne la 5 (calcolo degli slot ripetuto in `firstFree`), vedi "Rifiniture" sotto.

**Rifiniture (2026-10-16, dopo la review)**
- Ultimo appuntamento: cancellate escluse nella query (`limit 1`); e2e con storico reale (completata più vecchia, cancellazione più recente).
- `fetchWhenDay` riceve `recentBarberId` dal client invece di rileggere la sessione; la pagina legge barbieri e periodo in parallelo.
- Giorni "senza posti": bordo tratteggiato e data in `text-muted-foreground` (6,7:1); contorno del focus non più tagliato nella striscia (`p-1`).
- Dopo "prossimo: …" il focus va sull'intestazione del barbiere; regione `aria-live` con "Orari di <giorno>" (`it.booking.when.dayAnnounce`).
- Riepilogo: parametro `preferito` per "Indietro" e "Cambia orario"; e2e per `barbiere=any` e per "Cambia orario" dopo un orario preso nel frattempo.
- "Primo libero" limitato ai barbieri della pagina (`firstFreeAmong`); `it.booking.time.loading` rimosso.
- Risposte in ritardo: stato del cambio di giorno in un reducer puro (`src/lib/booking/when-state.ts`) con test Vitest.
- SPEC §5.2: oggi, dopo l'ultima fascia, il giorno risulta "chiuso" (decisione accettata, nessuna migrazione).
- Esito: lint, typecheck, Vitest (50 file, 1982 test) ed e2e (142) verdi.

**"Quando?" a colonne per barbiere (2026-10-18)**
- Richiesta dell'utente: da sezioni impilate a colonne affiancate, solo layout (dati, regole e URL invariati). Prima fase approvata con screenshot a 390×844 e 1280×800 (giorno normale, colonna con oltre 20 orari scrollata, barbiere senza posti, 5 barbieri con dati temporanei poi rimossi), in `.playwright-mcp/quando-colonne/`.
- Colonne di larghezza uguale (oltre 4: minimo 5 rem e scorrimento laterale con snap, a 390 px la quinta sporge di 30 px); testata alta uguale con ritratto da 32 px, nome ed etichetta "Il tuo" sull'angolo del ritratto; orari uno per riga (44 px) con divisore "Pomeriggio"/"Pom."; bio non mostrata; "Nessun orario" e "prossimo:" su due righe.
- Sugli schermi alti almeno 600 px la pagina è alta `100dvh` (`body:has([data-when-columns])` in `globals.css`, variante Tailwind `tall`) e ogni colonna scorre da sola con `overscroll-behavior: contain` e sfumatura in fondo; sotto scorre la pagina intera. Al cambio di giorno le colonne tornano in cima.
- Parte sopra compatta (`StepHeader compact`, striscia da 48 px con il mese accanto al numero solo al primo giorno e al cambio, "Primo libero" da 48 px): a 390×844 il primo orario parte a 366 px (prima ~530) e se ne vedono 9 per colonna.
- Test approvati dall'utente: `booking-when.spec.ts` (contratto, flusso con la verifica sticky a 390×560, "Nessun orario", bio non mostrata) e `booking-polish.spec.ts` (bio non mostrata); nuovo `booking-when-columns.spec.ts` (4 colonne affiancate, overscroll contain, scorrimento isolato, tocco → riepilogo; 5 barbieri con scorrimento laterale).
- Documenti: SPEC §5.2, ADR 012, DESIGN.md.
- Esito: lint, typecheck, Vitest (50 file, 1982 test) ed e2e (144) verdi.
- Review: nessun bloccante. Corretta subito la 1 (spazio fra "prossimo:" e la data, così la verifica negativa di `booking-when.spec.ts` torna a controllare il testo). Migliorie da decidere con l'utente: "Il tuo barbiere" per lo screen reader dentro l'h2; `bio` ancora letta da `getBarbersForService`; `firstBioLine` e `it.booking.when.morning` usati solo dai test (ADR 012 da precisare); `formatNextFree` spezzato con `split(", ")`; e2e sul ritorno in cima al cambio di giorno; testata centrata da citare in DESIGN.md; soglia `37.5rem` ripetuta in `globals.css`; `mark` ignorato da `StepHeader compact`; `scroll-padding` sotto la sfumatura; prova a mano su iPhone (Safari e PWA).

**Rifiniture delle colonne (2026-10-19, dopo la review)**
- Applicate con l'approvazione dell'utente: "Il tuo barbiere" per lo screen reader dentro l'h2, dopo il nome (l'etichetta "Il tuo" sul ritratto è solo visiva); `getBarbersForService` non legge più la `bio`; `firstBioLine` e `it.booking.when.morning` restano con un commento (li coprono i test di accettazione, possibili usi futuri), ADR 012 corretto; link "prossimo" composto da due funzioni pure (`formatNextFreeDay` + `formatSlotTime`, test in `src/lib/booking/when.test.ts`) invece di `split(", ")`; nuovo e2e in `booking-when-columns.spec.ts` sul ritorno in cima al cambio di giorno; DESIGN.md cita la testata centrata; le due soglie `37.5rem` di `globals.css` si richiamano a vicenda; `StepHeader` non accetta più `mark` insieme a `compact` (tipo); `scroll-pb-10` sulla lista degli orari, così un orario raggiunto da tastiera non resta sotto la sfumatura.
- Esito: lint, typecheck, Vitest (51 file, 1984 test) ed e2e (145) verdi.
- Da fare a mano: prova su iPhone, in Safari e nella PWA installata (`100dvh`, scorrimento interno delle colonne).

**"Indietro" dal riepilogo e "Prenota" in Le mie prenotazioni (2026-10-19)**
- Correzioni segnalate da iPhone (commit `da21078`); e2e `booking-back-to-day.spec.ts` e `my-bookings-book-cta.spec.ts`.
- Ritorno con la cronologia (gesto indietro, freccia del browser): Next 16 sostituisce `history.replaceState` e anche con `null` ricopia nella voce il proprio stato (`__NA`, albero del router), quindi lo stato del router non si perde. Ma quell'albero è la pagina resa dal server alla **prima apertura** di "Quando?": il cambio di giorno avviene sul client (`fetchWhenDay`) e aggiorna solo l'URL. Tornando indietro, Next ripristina quella pagina dalla sua cache (`ACTION_RESTORE`, nessuna richiesta al server) e `WhenPicker` si rimonta con il vecchio `initialDay`, mentre l'URL ha `giorno=X`. Il link "Indietro" della testata non ha il problema: è una navigazione nuova verso `?giorno=X`, resa giusta dal server.
- Per questo `WhenPicker`, al montaggio, legge `giorno` dall'URL (`useSearchParams`) e sceglie il giorno con la stessa `initialDay(days, giorno)` del server; se è diverso da `initialDay` lo carica subito e non tiene in memoria il vecchio giorno (forse superato). All'apertura normale dal server i due coincidono: nessuna richiesta in più e nessuna differenza all'idratazione. **Non è ridondante**: senza, il ritorno con la cronologia riapre il primo giorno disponibile (lo verifica `booking-back-to-day.spec.ts`, caso `goBack`).
- L'URL segue il giorno selezionato (al tocco, non all'arrivo degli orari), così un ritorno o un ricaricamento ritrovano la scelta anche se il caricamento è fallito.
- Alternativa scartata: `key` su `<WhenPicker>` (per esempio il giorno). Nel ripristino dalla cache le props sono quelle della prima apertura, quindi la `key` non cambierebbe e non risolverebbe nulla; in compenso azzererebbe stato, giorni in memoria e scorrimento delle colonne a ogni rimontaggio.
- Colonne: tornano in cima solo al cambio di giorno, non all'idratazione (uno scorrimento fatto prima dell'idratazione restava azzerato; era la causa dell'instabilità di `booking-when-columns.spec.ts` "cambio di giorno").
- Le mie prenotazioni: "Prenota" (stile del pulsante della home, 56 px) compare anche quando non ci sono prenotazioni future confermate ma ci sono passate o cancellate, con il testo `it.booking.list.noUpcoming`; con la lista vuota resta il testo di prima.

## Prestazioni: meno attese nel caricamento delle pagine (2026-10-20)

**Misura iniziale** (build di produzione locale, Supabase locale, 5 richieste per pagina dopo una di riscaldamento; strumentazione temporanea, poi rimossa: `fetch` che registra le chiamate a Supabase e `Server-Timing` nel proxy). Un'"ondata" è un gruppo di chiamate in parallelo; le ondate sono in sequenza e in produzione ognuna costa almeno un viaggio verso Supabase.
- `getClaims()` verifica il JWT in locale: chiavi ES256 (in locale e sul progetto cloud), JWKS in cache a livello di modulo per 10 minuti (un solo fetch in 464 richieste).
- La produzione rispondeva ancora da iad1 (`X-Vercel-Id: fra1::iad1::…`) dopo lo spostamento in dub1: il cambio di regione vale dal deploy successivo.
- Senza `loading.tsx` il prefetch dei Link non portava nulla di utile: al tocco partiva sempre la richiesta completa, senza riscontro.

**Fatto** (approvato dall'utente: punti 1, 2, 3, 4, 6; del 5 solo il matcher; il 7, nome del negozio in cache per i metadati, rimandato)
- Scheletri `loading.tsx` statici (nessuna animazione) per listino, "Quando?", riepilogo e Le mie prenotazioni, con contenitori e altezze delle pagine: verificato con Playwright a 390×844 che titolo, liste, striscia dei giorni, colonne e pannello non si spostano all'arrivo del contenuto. Listino ed elenco prenotazioni in route group (`prenota/(servizio)`, `prenotazioni/(elenco)`), così il loro scheletro non avvolge "Quando?", il riepilogo e la conferma.
- Area staff **senza** scheletro: `admin/(panel)/loading.tsx` faceva rispondere 200 invece di 404 a `notFound()` (la risposta parte prima della pagina; e2e `admin-calendar.spec.ts`) e mostrava lo scheletro mentre i test delle statistiche leggevano le righe. La pagina del calendario deve restare in `(panel)/page.tsx` (`calendar-access.test.ts`), quindi lo scheletro non si può limitare al calendario.
- Una sola lettura del profilo per rendering: `getCurrentUser` legge anche `no_show_count`; il blocco della prenotazione non rilegge `profiles` (`getBookingProfile` rimossa). `getVerifiedUserId` (getUser in `cache()`) fa partire prenotazioni e prossima prenotazione insieme alla lettura del profilo. `requireRole` e `getUser` nelle pagine invariati; nessuna pagina mostra dati prima di `requireRole`.
- Letture indipendenti in `Promise.all` con i controlli: listino, "Quando?" (servizio, barbieri, panoramica), riepilogo (servizio e barbieri), home, calendario (impostazioni e schede insieme a `requireRole`; filtro per ruolo con `staffBarbersFor` dopo).
- `getBookableServices` in `cache()`; `ShopInfo` con le impostazioni della disponibilità e `loadInput` usa `getShopInfo()` invece di rileggere `shop_settings`.
- Proxy: matcher senza `/icon/…` e `/apple-icon`; logica invariata. "Quando?": `prefetch={false}` sugli orari della griglia (il riscontro al tocco è `SlotPending`).

**Prima → dopo** (stesse pagine e stesso metodo; mediane in ms, documento / navigazione RSC)

| Pagina | Ondate | Chiamate | Documento | RSC |
|---|---|---|---|---|
| Home (cliente) | 4 → 3 | 7 → 7 | 50 → 50 | 48 → 45 |
| Listino | 5 → 3 | 6 → 5 | 50 → 46 | 55 → 43 |
| "Quando?" | 7 → 4 (5 in viaggi di rete) | 11 → 9 | 79 → 56 | 66 → 50 |
| Riepilogo | 6 → 3 | 7 → 6 | 56 → 43 | 57 → 42 |
| Le mie prenotazioni | 5 → 3 | 6 → 5 | 52 → 44 | 50 → 41 |
| Calendario, giorno | 6 → 4 | 11 → 11 | 62 → 52 | 54 → 45 |
| Calendario, settimana | 6 → 4 | 12 → 12 | 69 → 57 | 55 → 46 |
| Home anonima | 1 → 1 | 3 → 3 | 11 → 9 | 8 → 8 |

- In locale ogni query costa 2–5 ms e `getUser` circa 30 ms, quindi i millisecondi cambiano poco: in produzione conta il numero di ondate, ognuna almeno un viaggio di rete. In "Quando?" impostazioni → disponibilità restano in sequenza dentro la seconda ondata (in parallelo con `getUser`).
- Sessione nel browser (home, listino, "Quando?", calendario, con i prefetch): 77 → 72 passaggi dal proxy; le icone non passano più dal proxy.
- `notFound()` delle pagine con scheletro (impostazioni del negozio mancanti) ora risponde 200 con la pagina "non trovata", non 404: caso di configurazione rotta, i redirect di accesso li fa prima il proxy.
- Review (subagent `reviewer`): nessun bloccante. Applicate: `AccessNotice` sostituito da `BlockedNotice` (il caso "profilo non leggibile" non esiste più: con la lettura unica un errore su `profiles` dà utente null e `requireRole` rimanda al login, come prima quando falliva la prima lettura; la miglioria 5 della review di fetta 8b è assorbita, `it.booking.errors.profileLoad` rimosso); errore della lettura del profilo registrato (`loadProfile`).
- Compromessi noti: "Quando?" calcola la panoramica anche per un cliente bloccato o un servizio non prenotabile (casi rari, scartata prima di rendere); la home legge la prossima prenotazione anche per lo staff (filtrata per il proprio id, nessun risultato, non mostrata). Lo scheletro del riepilogo non ha "Indietro" (il link dipende dall'URL): durante il caricamento si torna con il tasto del browser.
- Esito: lint, typecheck, Vitest (51 file, 1986 test) ed e2e (148/148) verdi sul codice finale. **Da tenere d'occhio**: `admin-stats-default-grouping.spec.ts` ("ogni periodo rapido…") è fallito in 3 giri completi su 6 (0 righe contate subito dopo "Applica"), sempre verde da solo (21/21 ripetuto con `booking-when.spec.ts`) e verde nel giro di confronto sul codice di partenza (un solo giro). La pagina delle statistiche non è cambiata e non ha scheletri né Suspense; il test conta le righe appena cambia l'URL di un `<form method="get">` nativo, quindi può leggere il documento ancora in arrivo. Un giro ha avuto anche un'attesa scaduta su "Primo libero" (`booking-when.spec.ts`), mai ripetuta.

## Attese stabili negli e2e (2026-10-20)

- `admin-stats-default-grouping.spec.ts` (commit `307a752`): dopo "Applica" (modulo GET nativo) aspetta il raggruppamento mostrato ("Automatico (…)") e la tabella "Per servizio"; i periodi rapidi aspettano anche le date del periodo. Asserzioni invariate.
- Login dello staff: misurato in un giro completo normale il passaggio a `/admin` dopo il login, prima e dopo il commit perf (`4a86085` e `60015c4`): mediana 1872 e 1874 ms, nessun caso oltre 5 s in 64 e 61 login, massimo 3,9 e 4,9 s. Nessun peggioramento.
- `loginAsAdmin` e `loginAsBarber` (`admin-helpers.ts`) aspettano fino a 15 s il menu dell'area staff (`waitForStaffArea`) prima del controllo del percorso; stessa attesa in `admin-staff-accounts.spec.ts` dopo lo sblocco. Asserzioni invariate. Nella suite admin con `--repeat-each=10` non è più fallito nessun login degli helper; i conflitti di dati rimasti (`admin-calendar-cancelled-overlap`, `admin-stats-to-update` "a zero") vengono dalle copie parallele della ripetizione.
- **Da tenere d'occhio**: `my-bookings-book-cta.spec.ts` è fallito una volta sotto carico, alla registrazione del cliente ("link inviato" non comparso su `/accedi`), prima di arrivare a Le mie prenotazioni.

## Niente scheletri, riscontro sul link toccato (2026-10-20)

**Causa.** React (quello incluso in Next) mostra il contenuto sospeso non prima di 300 ms dopo il fallback (`globalMostRecentFallbackTime + 300` in `react-dom-client`). Con gli scheletri `loading.tsx` il contenuto vero arrivava sempre circa 300 ms dopo lo scheletro, anche con il server a 40–150 ms: più lento che senza scheletro.

**Decisione dell'utente.** Tolti tutti gli scheletri del commit perf (listino, "Quando?", riepilogo, Le mie prenotazioni; `src/components/skeleton.tsx`, `it.loading`); listino ed elenco tornano a `prenota/page.tsx` e `prenotazioni/page.tsx`. Al loro posto `LinkPending` (`src/components/link-pending.tsx`, `useLinkStatus`): il link toccato diventa pieno con il segno del tema mentre la pagina si apre, lo stesso stato che avevano gli orari (`SlotPending` sostituito). È su: righe del listino, "Prenota" (home e Le mie prenotazioni), "Prenotazioni" nell'intestazione, "Le mie prenotazioni" in home e nel biglietto, "Indietro" del flusso, "Ricomincia", "Cambia orario", i link della conferma. Verificato con Playwright a 390×844: il link non si sposta (stessa posizione prima e durante l'attesa), il segno si anima solo con `prefers-reduced-motion: no-preference` (`animation: none` con `reduce`). Le altre ottimizzazioni del commit perf restano.

**Misure** (build di produzione locale, cliente demo; mediane in ms, max fra parentesi; 15 tocchi in sequenza e 4 schede × 5 in parallelo)

Tocco su "Primo libero" → URL / titolo / contenuto vero del riepilogo:

| Codice | Sequenza | 4 paralleli |
|---|---|---|
| `4a86085` (prima del perf) | 135 / 149 / **151** | 430 / 454 / **459** |
| `60015c4` (perf, con scheletro) | 90 / 106 / **415** | 128 / 185 / **579** |
| Finale (senza scheletri, `LinkPending`) | 108 / 122 / **125** (155) | 318 / 346 / **351** (477) |

Tocco su "Prenota" in home → URL / righe del listino:

| Codice | Sequenza | 4 paralleli |
|---|---|---|
| `4a86085` | 88 / **95** (133) | 216 / **224** (348) |
| Finale | 77 / **86** (97) | 189 / **197** (241) |

In dev (stessa misura su "Primo libero", contenuto vero): `4a86085` 283 in sequenza e 772 in parallelo; con lo scheletro 585 e 880; senza scheletro 338 e 800.

**`my-bookings-book-cta.spec.ts` (indagine).** Fallito in 3 giri completi su 10 col dev server, sempre alla registrazione del cliente: schermata di errore generica dopo una server action (`/accedi` due volte, `/auth/confirm` una). Nel log del server solo `SyntaxError: Unexpected end of JSON input at JSON.parse (<anonymous>)` sulla POST dell'azione, nessun frame dell'app; nel browser "An unexpected response was received from the server".
- Il codice dell'app su quel percorso non lancia: `requestMagicLink` restituisce gli errori di Supabase come stato e `resetLoginCode` è in un `.catch`; la lettura unica di utente e profilo (`getVerifiedUserId` → `loadProfile`) restituisce null su errore, come prima (`requireRole` rimanda al login); un cliente appena registrato col profilo incompleto viene rimandato dal proxy a `/profilo/completa` prima del rendering. L'avviso "profilo non leggibile" copriva solo il fallimento di una seconda lettura che non esiste più.
- Next in dev rilegge i manifest dal disco a ogni richiesta e lo stesso Next documenta che possono essere letti mentre Turbopack li riscrive durante una compilazione (`load-components.js`, 3 tentativi solo in dev).
- 110 esecuzioni ripetute dei test di login del cliente col dev server: nessun errore. 2 giri completi sulla build di produzione (stessi worker, nessun tentativo in più): l'errore non compare mai e il test passa in entrambi.
- Conclusione: lettura concorrente dei file di Next durante la compilazione al volo del dev server, non un'eccezione del codice dell'app; nessuna correzione nel codice. In CI gli e2e girano sulla build di produzione.

**Altri e2e instabili visti in questi giri** (nessuno legato al codice dell'app):
- `admin-stats-to-update.spec.ts` "a zero": i due test dello stesso file scelgono a caso una settimana fra gennaio e febbraio 2011–2015 e girano in parallelo; se la scelgono uguale, "a zero" vede le 2 prenotazioni dell'altro ("Received: 2"). Fallito in 2 giri normali.
- `offline.spec.ts` (solo build di produzione, service worker): fallito una volta in un giro completo, 5/5 ripetuto da solo.

**Note per i prossimi giri e2e**
- **Causa nota dei fallimenti solo in dev**: errore del dev server di Next che legge a metà i propri manifest mentre li riscrive durante una compilazione al volo. Sintomo: `SyntaxError: Unexpected end of JSON input at JSON.parse (<anonymous>)` nel log del server su una POST di server action, schermata di errore generica nel browser ("An unexpected response was received from the server"). Se compare solo col dev server e non sulla build di produzione, non è un difetto dell'app.
- **Da tenere d'occhio**: `offline.spec.ts` (solo build di produzione) è fallito una volta in un giro completo; da solo passa.

## Fetta 8f – "Quando?" a fila continua di giorni e caselle arrotondate

**Stato**: completata il 2026-10-25 sul branch `fetta-8f` (da `origin/main` `63411f6`, test di accettazione in `8bf863b`). Review senza bloccanti; manca la prova su iPhone.

**Decisioni (approvate dall'utente il 2026-10-25)**
- La fila parte dal primo giorno non chiuso ("senza posti" compresi); all'apertura senza `giorno` si va comunque al primo giorno con orari.
- "Visibile" esclude i 16 px di margine sinistro (scroll-padding).
- Giorno selezionato calcolato da `scrollLeft` una volta per frame (equivalente di IntersectionObserver, funzione pura `dayAtScroll`).
- Striscia a ogni frame; `replaceState` e annuncio aria-live solo a fila ferma (`scrollend`, ripiego 150 ms dove manca).
- Scorrimento comandato bloccato sul giorno di arrivo, sbloccato da `pointerdown`/`wheel`/`keydown`.
- Script inline di apertura statico che legge `data-initial-day` (validato dal server); nota sul nonce in ADR 013.
- Pulsanti "Giorno precedente/successivo" solo da 1024 px, fuori dalla fila; ←/→ con il focus nella fila.
- Colonne come gruppi "Orari di <nome>, <giorno>"; errore di caricamento solo nelle colonne del giorno; su desktop 4 colonne nella larghezza della fila.
- `--ink-control-rest` usato solo dalle caselle: schiarito direttamente (`#9AA1AB`), senza token dedicato. `--surface-control` in Mosca = `--surface`. Bordo ≥ 3:1 sia contro la casella sia contro lo sfondo con la luce d'ambiente.
- Coda pura delle richieste (`when-queue.ts`) con test approvato; `when-state.ts` diventa cache per giorno con id di richiesta (test 8e adattati, non rimossi).

**Fatto**
- `src/lib/booking/when-row.ts` (geometria pura), `when-queue.ts` (coda), `when-state.ts` (cache per giorno).
- `WhenPicker` riscritto:
  - fila continua con segnaposto, finestra disegnata e testata con la data;
  - spazio con linea fra i giorni, aggancio morbido;
  - striscia che segue, URL e annuncio a fila ferma;
  - apertura senza salto (script nell'HTML del server, `useLayoutEffect` sul client);
  - ridimensionamento con `rescaleScroll`, pulsanti e frecce su desktop.
- Token `--radius-control`, `--surface-control`, `--control-gap`, `--day-gap`, `--day-divider` (Mosca invariato a vista). `LinkPending` segue gli angoli del link.
- `StepHeader compact`: titolo e sottotitolo su una riga, sottotitolo troncato.
- Documenti: SPEC §5.2 e §11, ADR 013 (e nota in ADR 012), DESIGN.md.
- Precaricamento ridotto ai giorni visibili ±1. Le server action di Next partono una alla volta: con tutta la finestra in coda, la conferma del riepilogo aspettava dietro le richieste dei giorni e nella suite completa scadeva. All'apertura ora partono 3 richieste di circa 70 ms (misura in dev).
- Errore trovato con gli e2e e corretto: la fila scorsa prima dell'idratazione scriveva nell'URL il giorno di apertura invece di quello visibile.

**Secondo giro (2026-10-25, decisioni dell'utente)**
- Test modificati con approvazione:
  - `booking-when-row.spec.ts`: conta solo le `replaceState` senza `__NA` (Next ne fa una sua dopo ogni chiamata della pagina); `beforeAll` rimuove i servizi "E2E Fila …" rimasti da giri interrotti, con barbieri e prenotazioni. Solo quelli più vecchi di 10 minuti (età letta dal tag di `uniqueName`), così non tocca i test in corso negli altri worker.
  - `booking.spec.ts:214`: intestazioni cercate nel giorno selezionato.
  - `booking-when-queue.test.ts`: casi del nuovo tentativo attraverso la coda.
- Applicate tutte e sei le migliorie della review:
  - il focus dopo "prossimo: …" va sempre sull'intestazione del barbiere del link nel giorno di arrivo (regola SPEC §5.2 della 8e), anche se la finestra disegnata non cambia;
  - il nuovo tentativo dopo un errore passa dalla coda (azione `retry`);
  - il ResizeObserver osserva la fila e il primo giorno (solo testo ingrandito);
  - `rounded-control` è una `@utility` invece di una voce di `@theme` che rimandava a se stessa;
  - `data-day` anche sul gruppo disegnato;
  - i giorni da caricare si calcolano sulla larghezza utile, senza il margine destro.
- In più:
  - il giorno scelto in fondo alla fila resta selezionato anche dopo `update()` (`chosenRef`);
  - i giorni vicini si chiedono solo dopo 600 ms a fila ferma, e una richiesta alla volta (sotto il limite di 3 della SPEC). Next esegue le server action in fila (`app-router-instance.js`): più richieste insieme non vanno più veloci, e toccando un orario la conferma del riepilogo passava dopo di loro. Nella suite completa `booking-polish.spec.ts:224` scadeva in 3 giri su 4; dopo, 2 giri completi verdi e suite da circa 6 a 3,2 minuti.
- Review veloce di questo giro:
  - un bloccante, corretto: in fondo alla fila la regola del giorno scelto controllava solo il bordo destro e poteva riselezionare un giorno uscito a sinistra. Ora è `settledDay` pura in `when-row.ts`, con test unitario in `src/lib/booking/when-row.test.ts`;
  - applicate anche la 2 (focus solo se lo scorrimento parte davvero, `scrollToDay` restituisce un booleano) e la 5 (commento spostato).

**Esiti**
- lint e typecheck verdi.
- Vitest verde 3 volte di seguito: 53 file, 2029 test; dopo le ultime correzioni 54 file, 2032 test.
  - Nel primo dei tre giri era fallito `theme.test.ts` ("Mosca" non compare in src/ fuori da src/themes/) per un mio commento in `tokens.css`, corretto.
  - Il fallimento del primo giro del 2026-10-25 (prima versione) non si è ripetuto e non ne ho il nome.
- e2e, intera suite in primo piano: 156/156 in due giri di fila sul codice finale.
- In un giro intermedio, sotto carico, due test Vitest fuori dalla fetta sono falliti per attese scadute (`barber-photo.test.ts`, "carica una WebP quadrata…", e `customers.test.ts`, "barber: i risultati portano blocked…"); da soli passano, 123/123.
- Screenshot in `.playwright-mcp/quando-8f/`:
  - neon a 390×844 e 1280×800: apertura su oggi, fila a metà fra due giorni, giorno senza posti, 5 barbieri, primo piano delle caselle;
  - Mosca prima e dopo (`mosca-prima-*`, `mosca-dopo-*`): caselle identiche (angoli vivi, bordo nero, gap 6 px). Cambiano solo la data in testata e la larghezza delle colonne.
- Misura in dev: all'apertura 1 richiesta per il giorno selezionato se non è già nella pagina, poi i vicini (circa 70 ms l'una) dopo 600 ms a fila ferma.

**Test instabili noti**
- `admin-calendar-week.spec.ts:217` ("l'admin crea una manuale da uno slot della settimana di Luca…"): fallito una volta dentro la suite completa con `expect.poll` scaduto dopo 5000 ms ("Expected: 1, Received: 0"); da solo passa 3 su 3 (`--repeat-each=3`). In un altro giro era fallito per barbieri rimasti da e2e interrotti (orari anche domenica e lunedì), poi rimossi.
- Dati rimasti da e2e interrotti per timeout possono falsare la vista settimana dell'admin: controllare i barbieri `E2E …` attivi se tornano 7 colonne.

**Problemi aperti**
- Migliorie della seconda review non applicate:
  - il nuovo tentativo dopo un errore parte solo quando il giorno torna selezionato (non c'è un pulsante "Riprova");
  - un commento in `tests/e2e/admin-helpers.ts` (`randomTag`) che ricordi che la pulizia di `booking-when-row.spec.ts` legge l'età dal prefisso del tag.
- Da provare a mano su iPhone (Safari e PWA): blocco dell'asse fra fila e colonne, aggancio, ripiego senza `scrollend`, apertura con `?giorno=` senza salto, "Indietro" e gesto indietro, rotazione.

## Fetta 8g – "Quando?": rifiniture della fila continua

**Stato**: completata il 2026-10-25 sul branch `fetta-8g` (da `origin/main` `e546e57`, test di accettazione in `e510440`). Niente commit 4: provate su iPhone le 5 varianti di `prototypes/scorrimento-8g/` (non committate, escluse con `.git/info/exclude`), l'utente ha deciso di tenere lo scorrimento attuale, risultato il più naturale (ADR 014 §4).

**Decisioni (approvate dall'utente il 2026-10-25)**
- Via "Primo libero" (riquadro, stato vuoto, testi, `firstFree` del motore, `firstFreeAmong`, parametri di `fetchWhenDay`); tolta anche l'utility `emphasis`, usata solo da lì. Annuncio aria-live `dayAnnounceEmpty` per un giorno senza orari; nessun annuncio dopo una rotazione.
- Orari di tutti i giorni della fila con la pagina (`slotsByDay` nel motore, `whenDays` in `getWhenOverview`); coda e precaricamento ritardato tolti.
- Ricarica in background con `GET /prenota/quando/orari` (dinamico, `requireRole` per prima, Zod, periodo prenotabile, cliente bloccato 403, `private, no-store`) quando la pagina torna visibile con orari più vecchi di 2 minuti ("2 minuti" letto come età dei dati). `loadedMany` sovrascrive anche un giorno caricato da una richiesta singola finita durante la ricarica (dati forse un po' più vecchi; accettato).
- Rotazione: ancora `{ day, barberIndex, fraction }` solo a fila ferma; posizione verticale a parte (scrollTop per colonna sugli schermi alti, `window.scrollY` sotto i 600 px).
- `booking.spec.ts`: `lastSlot` limitato al giorno selezionato (approvato durante l'implementazione: prima prendeva l'ultimo orario della pagina e funzionava solo perché i giorni vicini non avevano ancora orari).
- Progetto Playwright `mobile-webkit` (iPhone 14) solo per `booking-when-rotation.spec.ts`; `admin-settings` gira dopo anche questo.

**Fatto**
- Commit: `5a62c1e` feat (via "Primo libero"), `feb6503` perf (orari di tutti i giorni, route handler), `7938c43` fix (rotazione), `4c3202d` chore (`emphasis`), `676b894` docs (SPEC §5.2 e §11, ADR 014, nota in ADR 013).
- Primo orario a 390×844: 320 px dall'alto (prima circa 380), 9 orari visibili per colonna.
- Misure (cliente demo, seed con 3 barbieri e 30 giorni, mediane; dettagli in ADR 014):
  - build di produzione, documento: 86 → 96 ms; 121 → 352 KB crudi, 9,2 → 15 KB gzip;
  - build di produzione, navigazione RSC: 64 → 80 ms; 15 → 69 KB, 3,2 → 5,7 KB gzip;
  - dev, documento: 276 → 242 ms (rumore del dev server); 128 → 360 KB, 11 → 17 KB gzip.
  - Sotto le soglie (+150 ms, 30 KB compressi): strada "tutto con la pagina".
- Rotazione, causa trovata in WebKit: riscala da solo `scrollLeft` e manda `scroll`/`scrollend` prima del ResizeObserver; `scrollend` sceglieva il giorno con le misure vecchie (aperto sul 4/11, finiva sull'11–12 e cambiava l'URL). Ora il ridimensionamento parte dall'evento `resize` e da ogni scroll con la larghezza della fila cambiata.
- Scorrimento unico: verificato nei sorgenti di WebKit che `WKChildScrollView` (elementi `overflow: auto`) non ha `directionalLockEnabled` (default `NO`), solo `WKScrollView` (la pagina); rischio di diagonale nella variante A (ADR 014). Pagine di prova: attuale, A, B, C (testate con `animation-timeline`), D.
- Screenshot in `.playwright-mcp/quando-8g/` a 390×844, 844×390 e 1280×800: apertura, in basso, a metà fra due giorni, giorno senza posti (assenze temporanee sul DB locale, poi rimosse).

**Review** (subagent `reviewer`)
- Un bloccante, corretto: l'evento `resize` della finestra faceva partire un ridimensionamento anche quando cambiava solo l'altezza (barra di Safari che compare e sparisce scorrendo in orizzontale); dopo 150 ms la pagina sotto i 600 px tornava alla posizione di prima del gesto. Ora parte solo se cambia `window.innerWidth`. Da verificare su iPhone in orizzontale.
- Migliorie non applicate (decide l'utente):
  - M1: test del 403 per il cliente bloccato, del profilo incompleto e dello staff sul route handler;
  - M2: `getWhenDays` non controlla che il servizio sia prenotabile (escono comunque solo orari, come già con `fetchWhenDay`);
  - M3: se l'effetto del ResizeObserver riparte durante un ridimensionamento, `resizing` resta `true` fino al primo scroll;
  - M4: `pageY` vecchio passando da schermo alto a basso;
  - M5: dopo mezzanotte i giorni passati restano nella fila (la conferma li rifiuta);
  - M6: `inFlight` della ricarica in un `useRef`;
  - M7: validare la forma della risposta della ricarica;
  - M8: memoria verticale in un `useRef` invece che in uno stato mutato;
  - M9: periodo calcolato due volte (`dayStatuses` e `slotsByDay`), circa 10 ms;
  - M10: in `getWhenDays` due letture di "oggi" (a cavallo della mezzanotte);
  - M11: `rescaleScroll` senza usi nella pagina (resta con i suoi test);
  - M12: commento di `availability-actions.ts` da aggiornare (la route richiede il ruolo, la server action no).

**Esiti** (codice finale, dopo la correzione della review)
- lint e typecheck puliti; Vitest 55 file, 2046 test verdi.
- e2e, intera suite in primo piano: 161/161. In un giro precedente, il primo dopo l'avvio a freddo del dev server, era fallito una volta `booking-when-loading.spec.ts:267` (ricarica dopo `visibilitychange`); il dettaglio dell'errore è stato sovrascritto dal giro successivo e non si è ripetuto (161/161 nel giro dopo, 18/18 nei giri ripetuti). **Da tenere d'occhio.**
- File nuovi (`booking-when-loading`, `booking-when-rotation` su Chromium e WebKit) con `--repeat-each=3`: 18/18, prima e dopo la correzione.

**Ricarica a freddo (prima del push, richiesta dell'utente)**
- `booking-when-loading.spec.ts` 5 volte, ognuna con un dev server nuovo: 20/20.
- Intera suite 2 volte con la cache del dev server cancellata (`.next/dev`): 161/161 entrambe.
- Il fallimento unico di `booking-when-loading.spec.ts:267` non si è ripetuto; resta senza dettaglio dell'errore. Da tenere d'occhio.

**Scorrimento (chiuso)**
- Decisione dell'utente dopo la prova su iPhone: resta lo scorrimento attuale (fila orizzontale, colonne che scorrono da sole). Non si implementa nessuna variante; i test sospesi (4, 5, 6 dell'elenco e `booking-when-single-scroll.spec.ts`) non si scrivono.

**Problemi aperti**
- Da provare a mano su iPhone: rotazione (giorno lontano, a metà fra due giorni, colonna scorsa), pagina in orizzontale con la barra di Safari, nessuna attesa scorrendo fino all'ultimo giorno, ricarica tornando all'app dopo più di 2 minuti.
- Migliorie della review non applicate: elenco sopra.

## Audit del 30 ottobre: pianificazione

Report completo in `docs/audit/2026-10-30-ponytail.md`.

- **Punto 1 (Next.js, Zod): in corso**, PR `fix-dipendenze` da `main`, stessi commit portati sulla 8g.
- **Punto 6: chiuso il 2026-10-30, dentro la 8g.** Il nuovo tentativo su un giorno usa la GET `/prenota/quando/orari` con da = a, quindi anche al cliente bloccato risponde 403 (nuovo e2e). Eliminati `availability-actions.ts`, `getWhenDay`, `getAvailableSlots`, `getAvailableDays`, `availableDays`, `computeSlots`, `nextSlotByBarber`, `pickBarber` (con `assign.ts`) e il parametro barbiere di `loadInput`. Test: casi del motore spostati su `slotsByDay`; `availability-db` su `getWhenDays`; coerenza di `booking-db` su `slotsByDay` con la lettura del solo giorno; barbiere atteso scritto nel test (a parità lo ricava un FNV-1a del test, perché la data cambia a ogni esecuzione).
  - Riprodotto il punto 3: con `max_horizon_days` = 365 `getWhenDays` supera le 1000 righe, perde le prenotazioni e propone orari occupati. Resta nella fetta 8h.
  - Deciso il 2026-10-30: il nuovo tentativo resta. Costa poco e copre il caso in cui la pagina non porti tutti i giorni; oggi parte di rado, per questo l'e2e toglie due giorni dal payload.
- **Fetta 8h, sicurezza dati, prima del go-live:**
  - punto 2: privilegi staff solo con sessione da password. Il claim `amr` è un array di oggetti, quindi il controllo è `auth.jwt() -> 'amr' @> '[{"method":"password"}]'`, in `is_admin`, `is_staff` e `current_barber_id`. Da pensare il flusso di reimpostazione password (dopo un recupero si rientra con la password) e da aggiornare i claim nei test pgTAP;
  - punto 3: `availability_inputs` restituisce un solo `jsonb`, con un test oltre le 1000 righe.
  - da verificare: se la route degli orari applica anche il blocco per soglia di no-show (oggi il test copre solo `is_blocked`).
  - da valutare nella pulizia dei punti 7 e 10: `computeSlotsByBarber`, usata solo dai test.
  - da proporre: un `testTimeout` più alto solo per i file `*-db`, perché i test Vitest su database vanno in timeout a 5 s sotto carico e l'hook `Stop` segnala falsi errori.
- **Fetta 9b:** aggiunto il punto 4 (modifica di nome e telefono e revoca del marketing da `/profilo`).
- **Fetta 8i, correzioni admin:** punti 5, 8 e 9, ognuno con il suo test.
- **Pulizia a bassa priorità:** punti 7 e 10.
- **Domanda per il titolare** (SPEC §13.9): verifica in due passaggi per l'account admin. Senza, chi controlla l'email del negozio può reimpostare la password.

**Eccezione nota su `npm audit`**: restano aperti 3 avvisi low, tutti solo di sviluppo: `deepmerge` (GHSA-gcqx-w48m-w2h4), `@shadcn/registry` e `shadcn`, che dipendono da `deepmerge`. Si chiudono solo riportando `shadcn` alla 1.0 con `npm audit fix --force`, quindi restano aperti. `shadcn` non si toglie: `src/app/globals.css:3` lo importa. In produzione (`npm audit --omit=dev`) gli avvisi sono 0.

## Fetta 8j – Rifiniture di stile dell'area admin

**Stato**: completata il 2026-10-31 sul branch `fetta-8j` (da `origin/main` `5e1b4dd`, più i cherry-pick del plugin taste e del report; test di accettazione in `ee37141`). Nessuna migrazione. Fonte: `docs/audit/2026-10-31-taste.md`.

**Fatto**
- Menu con `aria-current="page"` anche nelle sottopagine (`activeSection`, componente client `AdminNav`), voci a capo su telefono, "Esci" con aspetto di link (resta un button in un form POST), in fondo alla barra su desktop. Nome del negozio al posto di "Area staff", senza mosca.
- Calendario: barra su una riga su desktop, due su telefono (tre nella settimana, con i barbieri); schede alte quanto il servizio (`cardGeometry`, `blockPosition` invariata), coda della pausa solo per le `confirmed` con `blocked_until > ends_at`, una riga sotto i 15 minuti; righe 44 px su telefono e 36 su desktop.
- Dettaglio su due colonne con titolo, `tel:`, "Salva nota" e "Salva modifiche". Servizi con "Elimina" fisso e neutro a riposo, lista su telefono. Clienti con badge solo per i bloccati nell'elenco e no-show "—" se zero. Statistiche con periodi vuoti nascosti (`vuoti=1`, SPEC §6.9), una sola etichetta del grafico, incasso più grande. Impostazioni a gruppi con "Salva" sticky ed effetto dei minuti.

**Decisioni**
- Causa dell'altezza delle schede: `blockPosition` arrotonda alle righe, non arriva a `blocked_until`; `buffer_min` è 0.
- `showEmpty` facoltativo in `StatsParams`, presente solo con `vuoti=1`: così `stats.test.ts`, fuori dalla lista approvata, non cambia.
- Tolto `bg-disabled` dalle celle occupate: il resto di riga sotto una scheda sembrava una coda.
- Il link dei periodi vuoti compare solo se ce ne sono. Limite di cancellazione nel gruppo Prenotazioni. Con giorni, ore e minuti l'effetto mostra le due unità più grandi.

**Verifiche**: lint, typecheck, Vitest 2114/2114, `test:db` PASS, e2e 186/186 su build di produzione. Screenshot in `.playwright-mcp/fetta-8j/` (`prima` con il seed appena reimpostato; `dopo` dopo gli e2e, che lasciano clienti di prova).

| Schermata | Prima 1440 | Dopo 1440 | Prima 390 | Dopo 390 |
|---|---|---|---|---|
| Calendario giorno | 6,7 | 7,4 | 6,2 | 7,0 |
| Calendario settimana | 6,5 | 7,0 | 5,8 | 6,5 |
| Dettaglio prenotazione | 6,2 | 7,3 | 6,4 | 7,1 |
| Clienti | 6,5 | 6,8 | 6,8 | 6,8 |
| Servizi | 6,6 | 6,9 | 5,9 | 6,9 |
| Statistiche | 6,5 | 7,2 | 6,0 | 6,4 |
| Impostazioni | 6,3 | 6,9 | 6,5 | 6,9 |

Critica sugli screenshot con `references/critique.md`: l'inspector non apre le pagine autenticate. Il tetto dei FAIL dovuti al neon resta non applicato, come nel report.

**Correzioni dopo la review (2026-10-31, commit "fix: rifiniture della fetta 8j")**
- L'utente ha approvato le due asserzioni con `?? false` di `admin-polish-8j.test.ts`. Da ora nessuna modifica ai test di accettazione senza il suo ok, anche a copertura invariata.
- M1: `weekCardGeometry` e `dayBlockPosition` usano il tratto più lungo fra orologio e minuti reali (`axisSpan`), con test su 25/10/2026, 31/10/2027 e 28/03/2027. M2: `slotBackgrounds`, separata da `daySlots` perché `SlotState` è fissato dai test.
- Voce attiva del menu con testo pieno e filetto. Spazio sopra la griglia tolto. Scheda da una riga su telefono: 42 px visibili, area di tocco 44 px con uno pseudo-elemento.
- Avviso di spostamento: su telefono nello spazio riservato, su desktop riquadro fisso in basso a destra che lascia passare i clic. "Annulla" dura 8 s, il messaggio altri 8; gli errori restano fino a "Chiudi"; cambiando giorno o settimana sparisce, dentro `useBookingMove` e senza rimontare le griglie (scorrimento conservato, esito di uno spostamento in corso mostrato comunque). SPEC §6.3 aggiornata.
- `admin-polish-8j.spec.ts`, con l'approvazione dell'utente: ora fissa alla riga dell'"Ospite da chiudere" e una data propria per ogni test che crea prenotazioni (la causa delle collisioni 23P01). `playwright.config.ts`: `trace: "retain-on-failure"` e `screenshot: "only-on-failure"`.
- Verifiche: lint, typecheck, Vitest 2132/2132, e2e 193/193 su build di produzione. Dopo l'ultimo cambio di data in `admin-polish-8j.spec.ts` rilanciato solo quel file.

**Problemi aperti**
1. `tests/e2e/booking-when-columns.spec.ts:103` ("4 barbieri a 390 px…") fallisce ogni tanto, solo sotto il carico della suite intera: `Error: percorso atteso: /prenota/riepilogo`, `Expected: "/prenota/riepilogo"`, `Received: "/prenota/quando"`, `Timeout 5000ms exceeded while waiting on the predicate` (`tests/e2e/booking-when-columns.spec.ts:182`). Dopo il tocco su un orario la pagina non cambia entro 5 s. Log: `.playwright-mcp/fetta-8j/when-columns/gate-suite-intera.log`. Causa non trovata e nessuno screenshot: da ora Playwright conserva screenshot e trace dei fallimenti. Visto 2 volte su 4 nei primi giri del file, 1 su 5 nell'ultima serie di giri completi; 10 su 10 verdi con un dev server nuovo a ogni giro, e verde nell'ultimo giro completo. Non escluso un bug reale del tocco.
2. Migliorie non applicate: M3 test della coda sugli stati non confermati; M4 effetto dei minuti dopo un salvataggio non valido; M5 ripiego se manca il nome; M6 Andamento senza righe in un periodo tutto vuoto; M7 36 px sui touch larghi, Barbieri e Orari fuori dal test dei 44 px; M8 terza unità omessa; M9 indentazione; area di tocco solo con servizio pari al passo; `weekGrid` calcola la fine dell'asse sull'orologio; `?? 0` di `axisSpan` col buco dell'ora legale; filtri duplicati in `week-grid.tsx`; commenti sugli anni riservati; mancano test per cambio barbiere, `undone` e `reject`.

**Date degli e2e (2026-10-31, commit "test: date univoche e pulizia negli e2e")**
- `testDate()` e `testMonday()` (`tests/e2e/admin-helpers.ts`, logica pura in `tests/e2e/test-date.ts`): ogni test ha un mercoledì d'inverno derivato da progetto, file, titolo e numero della chiamata. Il test fallisce con i due nomi se un altro ha già quella data (`claimDate`, azzerato da `global-setup.ts`). Al primo giro due test di `admin-fix-8j.spec.ts` hanno colliso, quindi il pool futuro va dal 2100 al 9999. Con `fromYear` e `toYear` le date passate restano negli anni che i test chiedevano.
- Sostituite le 13 chiamate di `randomWinterDate()`, tolta dagli helper, e le date a numero di `admin-polish-8j.spec.ts` e `admin-fix-8j.spec.ts`. `clearBookings` cancella le prenotazioni rimaste solo su quelle date e solo per quei barbieri, prima di crearle. Nota in testa ai file di accettazione, approvata dall'utente; nessuna asserzione cambiata.
- Restano con date casuali i test che usano i propri generatori (per esempio `futureWinterWeek` di `admin-calendar-week.spec.ts`).
- `devIndicators: false` in `next.config.ts`: in sviluppo l'indicatore di Next copriva "Esci" in fondo alla barra e faceva fallire `auth.spec.ts`. `npm run dev` cancella anche la build di produzione: prima di `next start` serve un nuovo `next build`.

**Date anche per settimane e giorni passati (2026-10-31, commit "test: date univoche anche per settimane e giorni passati")**
- `futureWinterWeek` e `pastDay` passano da `testDate()`, con `clearBookings` e `clearClosures` prima di creare i dati. `randomWinterDate` non esiste più.
- Indagine su `admin-calendar.spec.ts:271`: non è un difetto dell'app né delle policy. Il POST `next-action` su `/admin/calendario/682ac758-…` (2014-01-29, Luca) ha avuto 200 con esito `forbidden` da `if (!existing)` in `changeBookingStatus`, perché la prenotazione non esisteva più: anche l'API dell'admin non la trovava. L'aveva cancellata `clearBookings` di `admin-customers-mobile.spec.ts`, che ha 2014-01-29 come data fissa e gira in parallelo, mentre `pastDay` casuale era caduta sullo stesso giorno e barbiere. Regola: `clearBookings` solo su date di `testDate()`, mai su quelle casuali.
- Generatori casuali rimasti, fuori da questo intervento: `futureDay` (`admin-calendar`, `admin-calendar-move`), le date di `admin-calendar-cancelled-overlap`, `admin-calendar-move-autoscroll`, `admin-calendar-week-closed-days`, `admin-settings`, `admin-stats*`, `futureWorkday` di `admin-polish-8j` (solo per navigare).

## Fetta 8h – Sicurezza dati prima del go-live

**Stato**: completata il 2026-11-09 sul branch `fetta-8h` (da `origin/main` `68a2123`; test di accettazione in `9aef2ac`). Da rilasciare: prima `db push`, poi il deploy. Fonte: audit del 2026-10-30, punti 2 e 3. ADR 015.

**Fatto**
- Privilegi staff solo con sessione da password: `is_admin`, `is_staff` e `current_barber_id` richiedono `amr` password (migrazione `20261109090000_staff_privileges_require_password.sql`). Nell'app `isPasswordSession`, `requireRole` (con `getClaims`, una volta per richiesta) e il proxy, che tratta lo staff senza password come lo staff bloccato (cookie tolti) con `motivo=password`. Messaggio `auth.staffLogin.passwordRequired` su `/admin/login`.
- `availability_inputs_json` (migrazione `20261109090100_availability_inputs_json.sql`): stesse righe in un solo jsonb, usata da `loadInput` con validazione Zod. La vecchia `availability_inputs` resta per il rilascio.
- Limiti espliciti con avviso: assenze (`/admin/assenze` e `/admin/barbieri/[id]/assenze`) e chiusure 200; "Le mie prenotazioni" 200 (prima era un `.limit(200)` silenzioso); calendario 1000 con l'avviso "calendario incompleto".
- Route degli orari: già allineata alla soglia di no-show (stessa regola di `create_online_booking`); aggiunto il test Vitest.
- `testTimeout` e `hookTimeout` a 30 s solo per il progetto `db` di Vitest (commit a parte).
- SPEC §8: due righe (privilegi staff con password, nessun taglio silenzioso).

**Decisioni**
- `amr` si conserva al refresh del token: verificato in locale il 2026-11-08 (password e codice, uno e due refresh, stesso timestamp). La documentazione Supabase non lo dice: da ricontrollare a mano dopo un aggiornamento importante di Supabase Auth.
- Il flusso di reimpostazione della password nell'app non esiste. Un recupero chiesto direttamente a Supabase dà `amr` `recovery`, quindi nessun privilegio.
- Se `getClaims` fallisce, lo staff è respinto (in caso di dubbio si nega).
- Il corpo di `availability_inputs_json` è copiato e non richiama la vecchia funzione, così la rimozione è un semplice `drop`.
- Test esistenti modificati con l'ok dell'utente: `amr` password nei claim dello staff (pgTAP e finto client di `auth.test.ts`), nome della RPC nei finti client, `availability_inputs_json` nelle allowlist delle funzioni per anon (09 e 10). Nessuna asserzione cambiata.

**Verifiche**: lint e typecheck ok; Vitest 2211/2211; pgTAP 1320/1320; e2e completa 196/196 in 2 giri su 5 (vedi problema aperto 1). Falla riprodotta prima della correzione: con il token del codice email l'admin leggeva le prenotazioni via REST.

**Da fare in una migrazione futura**
- Togliere `availability_inputs` (`drop function public.availability_inputs(uuid, uuid, timestamptz, timestamptz)`), dopo che l'app con `availability_inputs_json` è in produzione. Nella stessa modifica: togliere la funzione dalle allowlist di `09_security_hardening` e `10_auth_profiles`, dagli override di `src/lib/db/database.ts`, da `17_availability_inputs.test.sql` e da `booking-db.test.ts` (servirà l'ok sui test).

**Problemi aperti**
1. `tests/e2e/admin-fix-8j.spec.ts:228` ("se il server rifiuta uno spostamento dopo un cambio di giorno…") nella suite intera sul branch è fallito 3 volte su 5: l'avviso non compare entro 20 s. Da solo passa (3 su 3, 3,4 s). Nella suite intera è passato su `main` (1 su 1) e sul branch senza la chiamata a `getClaims` in `requireRole` (1 su 1). Nessun errore di `getClaims` registrato. Ipotesi non provata: la latenza in più della server action (verifica del token con il JWKS scaricato da un client nuovo a ogni richiesta) allarga la finestra di gara fra la risposta trattenuta e il cambio di giorno. Decisione dell'utente.
2. Migliorie della review non applicate: motivo `password` invece di `disabilitato` per uno staff bloccato **e** senza password (proxy); date di `inputRowsSchema` solo `z.string()`; avviso delle "mie prenotazioni" dentro la sezione delle passate; `incomplete` vero anche con esattamente 1000 righe; link all'area staff ancora visibile nell'area cliente a uno staff senza password.
3. Domanda per il titolare (SPEC §13.9): verifica in due passaggi per l'admin. Chi controlla l'email dello staff può ancora reimpostare la password via API e poi entrare con quella.
