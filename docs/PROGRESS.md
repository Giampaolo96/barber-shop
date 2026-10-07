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

**Stato**: completata, review chiusa (un giro, un bloccante corretto; migliorie 1–8 applicate su richiesta dell'utente nel commit "fix: review fetta 6c"). Hash di partenza `b091929`, test di accettazione nel commit `fa5e268`. Migrazioni `20261007090000` e `20261007110000` da applicare a Supabase cloud (`db push`).

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

