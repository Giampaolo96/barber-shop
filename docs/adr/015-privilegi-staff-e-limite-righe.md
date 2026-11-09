# ADR 015 – Privilegi staff solo con password, nessun taglio silenzioso a 1000 righe

Data: 2026-11-09 · Stato: accettata · Fetta 8h · Audit 2026-10-30, punti 2 e 3 · Aggiorna ADR 002, 004 e SPEC §8

## Contesto

1. Lo staff entra solo con email e password (SPEC §2). Il controllo stava solo nell'app: chiunque può chiamare Supabase con la chiave pubblica (`POST /auth/v1/otp`, poi `POST /auth/v1/verify` con il codice ricevuto) e ottenere una sessione valida dell'admin. `is_admin()`, `is_staff()` e `current_barber_id()` guardavano solo l'id dell'utente. Riprodotto in locale il 2026-11-08: con il token ottenuto dal codice, l'admin leggeva le prenotazioni via REST.
2. PostgREST consegna al massimo `max_rows` righe (1000, `supabase/config.toml`) senza errore. `availability_inputs` restituiva una riga per intervallo e con un orizzonte lungo perdeva le prenotazioni: il cliente vedeva liberi orari occupati. Riprodotto con `max_horizon_days` = 365 (1377 orari occupati proposti nel test `availability-json-db`).

## Decisione

### 1. Privilegi staff solo con una sessione da password
- **Database** (migrazione `20261109090000_staff_privileges_require_password.sql`): i tre helper delle policy richiedono anche
  `coalesce(auth.jwt() -> 'amr', '[]'::jsonb) @> '[{"method":"password"}]'::jsonb`. Tutte le policy e le RPC dello staff passano da questi helper, quindi la regola vale ovunque. `current_user_role()` resta il ruolo scritto in `profiles` e non dà privilegi.
- **App**: `isPasswordSession(claims)` (`src/lib/auth/access.ts`) applica la stessa regola. `requireRole` legge i claim con `getClaims()` (una volta per richiesta) e rimanda lo staff senza password a `/admin/login?motivo=password`. Il proxy lo tratta come lo staff bloccato: cookie di sessione tolti e redirect al login con il motivo `password`, così non nasce un ciclo fra `/admin` e `/admin/login`. Se i claim non si leggono, lo staff è respinto.

**Formato di `amr`** (Supabase, "JWT Claims Reference" e "Multi-Factor Authentication"): array di oggetti `{ "method": …, "timestamp": … }`, il più recente per primo. Metodi: `password`, `otp` (codice email, SMS, magic link), `recovery`, `magiclink`, `invite`, `oauth`, `totp`, `sso/saml`, `anonymous` e altri. Con l'MFA l'array contiene sia `totp` sia `password`, e `@>` lo accetta.

**Refresh del token**: la documentazione non lo dice. Verificato in locale (Supabase CLI 2.119, 2026-11-08): dopo uno e due refresh `amr` resta `[{"method":"password","timestamp":<accesso>}]`, con lo stesso timestamp; una sessione da codice resta `otp`. Lo staff non perde quindi i privilegi al rinnovo del token. Da ricontrollare a mano dopo un aggiornamento importante di Supabase Auth (nessun test automatico: se cambiasse, lo staff verrebbe rimandato al login a ogni rinnovo del token, circa ogni ora).

**Reimpostazione della password**: nell'app non esiste un flusso. `/auth/confirm` accetta solo i tipi di `EMAIL_LINK_TYPES` e `/auth/callback` rifiuta lo staff. Chi chiama `/auth/v1/recover` direttamente ottiene una sessione con `amr` `recovery`, quindi senza privilegi; dopo aver cambiato la password deve rientrare dal login con la password nuova.

**Limite che resta**: chi controlla la casella email dello staff può reimpostare la password via API e poi entrare con quella. Contro questo serve la verifica in due passaggi per l'admin: domanda aperta per il titolare (SPEC §13.9).

### 2. Input della disponibilità in un solo jsonb
- `availability_inputs_json(...)` (migrazione `20261109090100_availability_inputs_json.sql`) restituisce un array `jsonb` con le stesse righe di `availability_inputs` (`kind`, `barber_id`, `starts_at`, `ends_at`), stessi grant (anon e authenticated) e stessa logica. Il corpo è copiato, così la vecchia funzione si toglie con un `drop`. Una risposta sola non subisce `max_rows`, come `admin_booking_stats` (ADR 010).
- `loadInput` usa la nuova funzione e valida la forma delle righe con Zod (tipi e chiavi; le date restano stringhe): una risposta con forma inattesa dà errore invece di orari sbagliati.
- La vecchia `availability_inputs` resta per il rilascio: l'app già in produzione la chiama finché Vercel non pubblica la nuova versione. Va tolta in una migrazione successiva (annotato in PROGRESS).

### 3. Elenchi con un limite esplicito e un avviso
Inventario delle letture via PostgREST che possono crescere:

| Lettura | Correzione |
|---|---|
| Assenze (`/admin/assenze` e `/admin/barbieri/[id]/assenze`) e chiusure (`/admin/chiusure`) | Le più recenti per prime, `PERIODS_LIST_LIMIT` = 200, una riga in più letta; oltre, avviso `admin.period.listTruncated` |
| "Le mie prenotazioni" (`getMyBookings`) | Era un `.limit(200)` silenzioso: ora `MY_BOOKINGS_LIMIT` = 200 più una riga e avviso `booking.list.myBookingsTruncated` |
| Calendario (`getBookingsInRange`) | `CALENDAR_BOOKINGS_LIMIT` = 1000; con 1000 righe lette la vista è `incomplete` e mostra `admin.calendar.incomplete` |

Già a posto: elenco clienti (pagine da 25, massimo 100), ricerca clienti (10), storico del cliente (100 più avviso), "da aggiornare" (200 più avviso), statistiche (jsonb), conteggi con `head`, orari, barbieri e servizi (pochi per natura), assenze e chiusure del calendario (limitate a giorno o settimana). Non esiste nessun export.

## Conseguenze

- Una sessione staff aperta con codice email, magic link o recupero password non legge né scrive dati riservati, neppure chiamando Supabase direttamente.
- I test pgTAP mettono `amr` password nei claim dello staff. Uno staff senza `amr` (per esempio un token creato a mano) non ha privilegi.
- I job lato server con la `service_role` non cambiano, perché la RLS non li riguarda.
- Ordine di rilascio: prima la migrazione (`db push`: le due migrazioni sono compatibili con l'app vecchia), poi il deploy dell'app. Vedi PROGRESS, fetta 8h.
