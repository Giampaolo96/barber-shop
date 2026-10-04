# ADR 005 – Prenotazione e cancellazione online

Stato: accettata (fetta 5, 2026-10-04)

## Contesto
Per l'ADR 001 il cliente non ha `insert` né `update` su `bookings`. Per la SPEC §3.7.2 le regole
della prenotazione online vanno garantite dal database, non solo dall'interfaccia. La SPEC §8
chiede un rate limiting sulla creazione. Il motore della fetta 4 (ADR 004) propone gli orari, ma
non è una garanzia.

## Decisione

**Tre funzioni `security definer`, eseguibili solo da `authenticated`.** Gli errori sono
`raise '<codice>'` con SQLSTATE `P0001`; l'app li traduce con `bookingErrorMessage`.

- `online_slot_error(service, barber, starts_at)` restituisce null se lo slot è valido e libero,
  altrimenti il codice della prima regola violata. Prima vengono le regole che non dipendono dal
  barbiere (`online_slot_shop_error`, funzione interna senza grant), poi quelle del barbiere:
  1. `service_unavailable`
  2. `not_aligned`
  3. `too_soon`
  4. `too_far`
  5. `closed`
  6. `barber_unavailable`
  7. `outside_hours`
  8. `unavailable`: assenza del barbiere **oppure** orario occupato, senza distinguerli (review
     fetta 5), così un cliente non deduce le assenze. La chiusura del negozio resta distinta.

  Applica le stesse regole del motore:
  - griglia dell'orologio locale, con i secondi a zero;
  - anticipo con bordo incluso;
  - orizzonte riferito all'inizio dello slot;
  - servizio interamente dentro una fascia di lavoro;
  - buffer corrente solo verso le prenotazioni successive.

  Le fasce contigue, anche a cavallo della mezzanotte, si uniscono con `range_agg` come fa
  `mergeIntervals` nel motore. La funzione è eseguibile dai clienti perché dice solo se uno slot è
  prenotabile, la stessa informazione degli orari liberi. Limite noto: `availability_inputs`
  (fetta 4, eseguibile anche da anon) restituisce ancora le assenze come intervalli `time_off`
  distinti da `busy`; unirli richiede di cambiare il motore (buffer diverso verso assenze e
  prenotazioni) ed è rimandato (decisione dell'utente).
- `create_online_booking(service, barber | null, starts_at, notes)` crea la prenotazione e ne
  restituisce l'id. I controlli, in ordine:
  1. il ruolo deve essere `customer`;
  2. il profilo deve essere completo, con il consenso privacy alla versione **corrente**
     dell'informativa;
  3. il cliente non deve essere bloccato: `is_blocked`, oppure `no_show_count` ≥ soglia, con la
     soglia 0 che disattiva il blocco per no-show;
  4. la nota non deve superare i 500 caratteri, dopo il trim; vuota diventa null;
  5. **lock** (vedi sotto);
  6. limiti per cliente: al massimo 3 prenotazioni online `confirmed` future e al massimo 10
     prenotazioni online create nelle ultime 24 ore, in qualsiasi stato;
  7. lo slot, oppure la scelta del barbiere;
  8. nessuna prenotazione `confirmed` dello stesso cliente che si sovrapponga a
     `[inizio, inizio + durata)`, confrontata su `[starts_at, ends_at)`, cioè senza buffer.

  Durata, prezzo, buffer e orari li calcola il trigger esistente.
- `cancel_own_booking(id)` cancella una prenotazione del cliente, con questi esiti:
  - `not_found` se la prenotazione è di un altro cliente o non esiste, senza distinguere i due casi;
  - `not_cancellable` se non è `confirmed`;
  - `too_late` se `now() > starts_at - cancel_limit_min`: esattamente al limite si può ancora
    cancellare.

  Altrimenti imposta `cancelled_by_customer`; autore e istante del cambio li registra il trigger.

**Concorrenza.** `create_online_booking` prende `pg_advisory_xact_lock(hashtextextended('create_online_booking:' || customer_id, 0))`
prima dei controlli sui limiti e sulle sovrapposizioni del cliente. Così due richieste parallele
dello stesso cliente si serializzano. Fra clienti diversi sullo stesso barbiere decide il vincolo
di esclusione (`23P01`), che l'app mostra come "Orario appena occupato, scegline un altro". In
pgTAP una gara reale fra due sessioni non si può simulare: il test 19 verifica solo che il lock
venga preso. L'effetto è verificato in `tests/acceptance/booking-db.test.ts` con richieste
parallele vere.

**"Nessuna preferenza" nel database.** Con `p_barber_id` null si controllano prima le regole del
negozio (`online_slot_shop_error`): l'errore rispecchia la causa reale (`too_soon`, `too_far`,
`closed`...). Poi il barbiere si sceglie nella stessa transazione, fra quelli per cui
`online_slot_error` è null, con il criterio di `pickBarber`; se nessuno è libero, `unavailable`:
1. vince chi ha meno prenotazioni non cancellate nel giorno locale;
2. a parità, il minore FNV-1a a 32 bit di `YYYY-MM-DD:barber_id` (`fnv1a_32`, funzione interna
   senza grant);
3. a ulteriore parità, l'id minore.

Non c'è retry lato server. Il test di coerenza verifica che la scelta coincida con `pickBarber`.

**Catalogo disattivato.** Il cliente legge servizi e barbieri delle proprie prenotazioni anche
dopo la loro disattivazione (policy `*_select_own_bookings`), sempre con le sole colonne pubbliche.

**App.**
- Server action in `src/lib/booking/actions.ts`, con `requireRole(["customer"])` e Zod, che
  chiamano le RPC con il client della richiesta, mai la service role.
- Gli orari sono esposti in `availability-actions.ts`, senza `requireRole`: la funzione dei dati
  è eseguibile anche da anon (ADR 004), ma nell'app le pagine del flusso (`/prenota/**`)
  richiedono il login, quindi in pratica le chiamano solo clienti autenticati.
- Il flusso ha 4 schermate:
  - `/prenota`
  - `/prenota/barbiere`, che si salta se il servizio ha un solo barbiere abilitato
  - `/prenota/orario`
  - `/prenota/riepilogo`

  Lo stato passa nell'URL. Il passo dell'orario è reso dal server a partire dall'URL (giorno
  compreso) e funziona anche prima dell'idratazione.
- Il cliente bloccato vede il messaggio già su `/prenota` e nel riepilogo.

**Ritorno dopo il login.**
1. Il proxy manda l'anonimo a `/accedi?next=<percorso e parametri>`.
2. `requestMagicLink` passa la destinazione, validata con `safeNextPath`, come `emailRedirectTo`,
   codificata in base64url.
3. Il template aggiunge `next={{ .RedirectTo }}` al link di `/auth/confirm`.
4. `confirmEmailLink` la decodifica e la rivalida.

Se Supabase non ammette l'URL di redirect, usa il Site URL e il cliente torna alla home.

## Conseguenze
- La SPEC §3.7.2 è garantita dal database per le prenotazioni online. Le manuali dello staff
  (fetta 6) restano soggette al solo vincolo di esclusione.
- Il consenso privacy si confronta con la versione corrente solo nel database. L'interfaccia
  (`profileComplete`) controlla ancora solo la presenza del consenso, quindi un cliente con un
  consenso vecchio scopre il problema alla conferma. Va allineato con la fetta 9.
- La consultazione degli orari non ha un rate limiting nell'app: ogni apertura di
  `/prenota/orario` calcola i giorni liberi su tutto l'orizzonte. La frena una regola del firewall
  Vercel su tutte le richieste (GET e POST) che iniziano con `/prenota` (`docs/DEPLOY.md` §7).
- Versione dell'informativa: in **Impostazioni** è in sola lettura finché non c'è il flusso di
  nuovo consenso (fetta 9). Cambiarla oggi impedirebbe a tutti i clienti di prenotare
  (`profile_incomplete`) senza modo di rinnovare il consenso.
- In produzione il ritorno dopo il login richiede i template personalizzati, quindi l'SMTP proprio
  (`docs/GO-LIVE.md`).
