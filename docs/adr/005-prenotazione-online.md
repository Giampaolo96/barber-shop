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
  altrimenti il codice della prima regola violata, in quest'ordine:
  1. `service_unavailable`
  2. `barber_unavailable`
  3. `not_aligned`
  4. `too_soon`
  5. `too_far`
  6. `outside_hours`
  7. `time_off`
  8. `closed`
  9. `taken`

  Applica le stesse regole del motore:
  - griglia dell'orologio locale, con i secondi a zero;
  - anticipo con bordo incluso;
  - orizzonte riferito all'inizio dello slot;
  - servizio interamente dentro una fascia di lavoro;
  - buffer corrente solo verso le prenotazioni successive.

  Le fasce contigue, anche a cavallo della mezzanotte, si uniscono con `range_agg` come fa
  `mergeIntervals` nel motore. La funzione è eseguibile dai clienti perché dice solo se uno slot è
  prenotabile, la stessa informazione degli orari liberi.
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

**"Nessuna preferenza" nel database.** Con `p_barber_id` null il barbiere si sceglie nella stessa
transazione, fra quelli per cui `online_slot_error` è null, con il criterio di `pickBarber`:
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
- Gli orari sono esposti in `availability-actions.ts`, senza login.
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
- La disponibilità anonima non ha un rate limiting nell'app: c'è una regola del firewall Vercel
  (`docs/DEPLOY.md` §7).
- In produzione il ritorno dopo il login richiede i template personalizzati, quindi l'SMTP proprio
  (`docs/GO-LIVE.md`).
