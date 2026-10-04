# ADR 004 – Motore di disponibilità

Stato: accettata (fetta 4, 2026-10-04)

## Contesto
SPEC §4 chiede di calcolare gli orari prenotabili lato server, restituendo solo orari. Per la RLS
(ADR 001) clienti e anon non leggono `working_hours`, `time_off`, `shop_closures` né `bookings`.
CLAUDE.md (regola 5) vuole il calcolo in funzioni pure in `src/lib/availability/`.

## Decisione

**Dati: `availability_inputs`, niente service role.** Nel percorso di disponibilità la service
role non si usa. La funzione `public.availability_inputs(p_service_id, p_barber_id, p_from, p_to)`
è `security definer` ed eseguibile da `anon` e `authenticated`. Restituisce solo
`(kind, barber_id, starts_at, ends_at)`. `kind` è l'enum `availability_kind`, con questi valori:
- `work`: fasce di lavoro;
- `time_off`: assenze;
- `closure`: chiusure, con `barber_id` null;
- `busy`: prenotazioni `confirmed`, con `ends_at = blocked_until`.

Nessun dato su clienti, servizi, stati o id di prenotazione.
- Considera solo i barbieri attivi abilitati a un servizio attivo; `p_barber_id` null significa "qualsiasi". Le chiusure escono sempre.
- Gli intervalli sono tagliati su `[p_from, p_to)` e sulla finestra prenotabile `[now(), inizio del giorno locale oggi + max_horizon_days + 1)`. Così, senza login, non si legge l'occupazione passata né quella oltre l'orizzonte.
- Le prenotazioni (`busy`) si leggono fino a 60 minuti oltre il limite superiore, cioè il buffer massimo. Così uno slot a ridosso della fine del periodo vede la prenotazione che il suo buffer toccherebbe.
- Le fasce settimanali diventano intervalli concreti con `local_band_to_interval(date, time, time, tz)`, una funzione interna senza grant. L'ora legale la gestisce Postgres: una fascia che attraversa le 02:00–03:00 dura un'ora in meno o in più.

**Motore puro** (`src/lib/availability/`): riceve impostazioni, durata, `now`, timezone e gli
intervalli di ogni barbiere.
- **Date:** `date` è sempre una data locale `YYYY-MM-DD` nella timezone del negozio. Uno slot appartiene al giorno locale del suo inizio, e i giorni del cambio d'ora durano 23 o 25 ore.
- **Griglia:** è allineata all'orologio locale, cioè ai multipli di `slot_granularity_min` dalla mezzanotte, non all'inizio di ogni intervallo libero. Le granularità ammesse sono 5, 10, 15, 20, 30 e 60; con qualunque altro valore il motore lancia un errore.
- **Buffer:** una prenotazione esistente occupa fino al suo `blocked_until`, cioè con il buffer copiato al momento della creazione. Il nuovo slot richiede `inizio + durata + buffer corrente` libero solo rispetto alle prenotazioni successive, come il vincolo di esclusione. Verso la fine della fascia, un'assenza o una chiusura basta `inizio + durata`.
- **Anticipo e orizzonte:**
  - l'anticipo è soddisfatto con inizio ≥ `now + min_advance_min`, bordo incluso;
  - l'orizzonte vale per l'inizio dello slot, ammesso fino alla fine del giorno locale di oggi + `max_horizon_days`.
- **"Qualsiasi":** gli slot sono l'unione senza duplicati di quelli dei barbieri. `pickBarber` sceglie solo tra i barbieri liberi in quello slot e vince chi ha meno prenotazioni non cancellate (`confirmed`, `completed`, `no_show`) nel giorno locale. A parità decide un hash FNV-1a di `data:barber_id`: il criterio è deterministico ma ruota da un giorno all'altro. I conteggi sono un input; la loro fonte arriva con la fetta 5.

**Server** (`src/lib/booking/availability.ts`, `server-only`): `getAvailableSlots` e
`getAvailableDays` validano l'input con Zod e usano il client della richiesta.
- `getAvailableDays` copre al massimo 366 giorni.
- Ogni chiamata fa un solo caricamento: una lettura delle impostazioni, una del servizio e una RPC per tutto il periodo.
- Restituiscono solo istanti ISO UTC o date locali.
- Non sono ancora esposte come server action o route: lo farà la fetta 5, insieme al rate limiting.
- I client Supabase usano `src/lib/db/database.ts`: i tipi generati, più le correzioni che il generatore non sa esprimere (`p_barber_id` e `barber_id` nullable in `availability_inputs`).
- Le regole condivise con l'area admin stanno in `src/lib/domain/` (`local-time.ts` e `settings.ts`). Il motore non importa nulla da `src/lib/admin/`.

## Conseguenze
- Chiunque può conoscere gli intervalli occupati dei barbieri (senza dati personali) nella finestra prenotabile. È un'informazione equivalente agli slot liberi, che sono pubblici.
- La griglia allineata all'orologio può lasciare inutilizzati pochi minuti dopo prenotazioni con durate fuori griglia.
- **Per la fetta 5** (SPEC §3.7.2 garantita nel database): la funzione `security definer` di creazione ricontrolla in SQL fascia di lavoro, assenze, chiusure, anticipo, orizzonte e **allineamento alla griglia**. Il motore TypeScript serve a proporre gli orari. È previsto un test di coerenza: ogni slot proposto dal motore deve essere accettato dalla validazione SQL, e un campione di orari non proposti deve essere rifiutato.
