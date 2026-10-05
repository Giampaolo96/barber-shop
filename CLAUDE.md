# CLAUDE.md – Barber Shop Booking

App di prenotazioni per un barber shop: PWA mobile per i clienti, area `/admin` web per titolare e barbieri.
La specifica funzionale completa è in `docs/SPEC.md`: leggila prima di ogni nuova feature e consideratela la fonte di verità sulle regole di dominio.

## Stack
- **Next.js** (App Router) + **TypeScript** strict
- **Tailwind CSS** + componenti shadcn/ui
- **Supabase**: Postgres, Auth, Row Level Security, Edge Functions, cron
- **Zod** per validare ogni input lato server
- **date-fns** + **date-fns-tz** per date e timezone
- Email transazionali: Resend
- Test: **Vitest** (unit), **Playwright** (e2e), test SQL per le policy RLS
- Deploy: Vercel (app) + Supabase cloud (DB)

## Struttura
```
src/app/(customer)/     # area clienti, mobile first
src/app/admin/          # area staff, desktop first
src/lib/availability/   # motore disponibilità: logica pura, senza I/O, 100% testata
src/lib/db/             # client Supabase e query tipizzate
src/components/         # UI condivisa
supabase/migrations/    # SOLO migrazioni SQL, mai modifiche manuali allo schema
supabase/seed.sql       # dati demo
tests/e2e/              # Playwright
docs/                   # SPEC.md e decisioni (ADR)
```

## Ambiente
Sviluppo su **Windows**. Claude Code usa Git Bash per i comandi; gli hook sono script PowerShell.
- Percorsi nei comandi con `/`, mai `\`; niente comandi solo-Linux nei `package.json` (usare `rimraf`, `cross-env` se servono).
- Supabase in locale richiede Docker Desktop avviato.

## Comandi
```
npm run dev                    # avvio locale
npm run lint                   # ESLint
npm run typecheck              # tsc --noEmit
npm test                       # Vitest
npm run test:e2e               # Playwright
npx supabase start             # DB locale (Docker Desktop)
npx supabase db reset          # riapplica migrazioni + seed
npx supabase gen types typescript --local > src/lib/db/types.ts
```
Prima di dichiarare finito un task: `lint`, `typecheck` e `test` devono passare. L'hook `Stop` lo verifica in automatico solo quando ci sono modifiche non committate in `src/`, `supabase/migrations/` o `supabase/seed.sql` (le cartelle dei test non contano: i test di accettazione nascono rossi).
Non lasciare suite di test lunghe (es. `test:e2e`) in background a fine turno: l'hook `Stop` lancia i controlli in parallelo e satura la macchina (timeout di login negli e2e, test Vitest in timeout). Eseguile in primo piano, oppure aspetta che finiscano prima di chiudere il turno.

## Regole di dominio non negoziabili
1. Nessuna sovrapposizione di prenotazioni `confirmed` dello stesso barbiere: garantita da un **vincolo di esclusione** (`btree_gist` + `tstzrange`), non solo dal codice.
2. Date salvate come `timestamptz` (UTC); visualizzazione e calcoli orari nella timezone del negozio (`Europe/Rome`). Mai usare l'ora locale del server.
3. Prezzi in **centesimi** (integer). Mai float per gli importi.
4. Durata e prezzo vengono copiati sulla prenotazione al momento della creazione e non seguono le modifiche successive al servizio. Sulla prenotazione li può cambiare solo l'admin (o un cambio di servizio, che li ricopia); `ends_at` e `blocked_until` li ricalcola sempre il database.
5. Il calcolo disponibilità vive in `src/lib/availability/` come funzioni pure (input: orari, assenze, prenotazioni, impostazioni, `now`). L'I/O sta fuori.
6. Le API di disponibilità restituiscono solo orari liberi, mai dati di altre prenotazioni o clienti.

## Sicurezza
- RLS attiva su ogni tabella, con test per ogni ruolo (`customer`, `barber`, `admin`).
- La `service_role` key si usa solo lato server ed Edge Functions; mai in codice client o variabili `NEXT_PUBLIC_*`.
- Ogni server action valida l'input con Zod e ricontrolla il ruolo dell'utente.
- Ogni route handler e ogni pagina di `/admin` chiama `requireRole`: il matcher del proxy esclude alcune estensioni (es. `.json`, `.js`, `.txt`) e il layout non viene rieseguito durante la navigazione, quindi nessuno dei due basta da solo.
- Nessun segreto nel repo: usare `.env.local` (ignorato) e documentare le variabili in `.env.example`.
- Niente `select *` (né `.select('*')` o `.select()` senza colonne) sulle tabelle con grant di colonna, oggi `barbers`: le colonne si elencano sempre in modo esplicito, altrimenti la query fallisce con "permission denied". Ogni nuova colonna su queste tabelle richiede un grant esplicito nella stessa migrazione.
- Ogni migrazione che crea una funzione fa `revoke all ... from public, anon, authenticated` e poi concede solo i grant voluti (lo verifica un test pgTAP).

## Modo di lavorare
- Per ogni feature non banale: **prima un piano** (file coinvolti, migrazioni, test), attendi conferma, poi implementa.
- Lavora per fette verticali piccole seguendo il piano in `docs/SPEC.md` §11.
- Per la logica di dominio scrivi i test prima o insieme al codice; copri i casi limite di `docs/SPEC.md` §12.
- Una migrazione per modifica di schema, con nome descrittivo; dopo ogni migrazione rigenera i tipi.
- Commit piccoli in stile Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`).
- Se una regola della SPEC è ambigua o in conflitto, fermati e chiedi invece di inventare.
- Le decisioni architetturali rilevanti vanno in `docs/adr/NNN-titolo.md` (contesto, decisione, conseguenze).

## Flusso di lavoro
- Ogni fetta di `docs/SPEC.md` §11 si sviluppa con `/slice <n>`: piano approvato → test di accettazione scritti dal subagent `spec-qa` → implementazione → review del subagent `reviewer` → aggiornamento di `docs/PROGRESS.md`.
- I test di accettazione non si modificano durante l'implementazione; se uno sembra sbagliato, chiedi all'utente.
- Una fetta per sessione. Usa `/clear` tra una fetta e l'altra: lo stato è in `docs/PROGRESS.md`, non nella conversazione.

## Convenzioni
- Codice, nomi di tabelle e variabili in **inglese**; testi dell'interfaccia in **italiano**, centralizzati in `src/i18n/it.ts`.
- Tabelle al plurale in snake_case (`bookings`, `working_hours`); enum Postgres per gli stati.
- Componenti React: server components di default, `"use client"` solo dove serve interattività.
- UI cliente: mobile first, tap target ≥ 44px, max 4 schermate nel flusso di prenotazione.
- Stile e temi: leggi `docs/DESIGN.md` prima di toccare l'interfaccia. Solo classi dei token (nessun colore letterale fuori da `src/themes/`), il tema si sceglie in `src/themes/active.ts`.
