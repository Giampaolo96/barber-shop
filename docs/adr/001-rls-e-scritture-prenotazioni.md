# ADR 001 – RLS, ruoli e scritture sulle prenotazioni

Data: 2026-10-02 · Stato: accettata · Fetta 1

## Contesto

La SPEC §3.7 chiede che gli invarianti delle prenotazioni siano garantiti dal database e non solo dall'interfaccia, e la §8 chiede RLS su tutte le tabelle. In Supabase `customer`, `barber` e `admin` condividono lo stesso ruolo Postgres (`authenticated`): grant e privilegi di colonna da soli non bastano a distinguerli.

## Decisione

**Ruoli e helper**
- Il ruolo applicativo sta in `profiles.role`. Le policy usano gli helper `current_user_role()`, `is_admin()`, `is_staff()` e `current_barber_id()`: `security definer`, `stable`, `set search_path = ''`, richiamati come `(select is_admin())` per essere valutati una volta per query.
- Il trigger di registrazione crea sempre un profilo `customer` e ignora i metadati del signup. Il ruolo si cambia solo dall'admin.
- Un admin è anche barbiere quando esiste una riga `barbers` con il suo `profile_id`; non c'è un flag dedicato.

**Profili**
- `authenticated` ha `update` solo sulle colonne `full_name`, `phone`, `role`, `is_blocked`. Due trigger `before update of` rifiutano con `42501`: `role` e `is_blocked` per chi non è admin, `no_show_count` per chiunque. Scattano quando la colonna compare nel `SET`, anche a valore invariato.
- I trigger di guardia lasciano passare gli update che arrivano da altri trigger (`pg_trigger_depth() > 1`) e dai ruoli di servizio (seed, migrazioni, `service_role`).
- `no_show_count` cambia solo con le transizioni di stato: +1 entrando in `no_show`, -1 uscendo, mai sotto zero.
- **Blocco per no-show**: il blocco automatico (fetta 5) si calcola confrontando `no_show_count` con `no_show_block_threshold` al momento della prenotazione. `is_blocked` resta solo il blocco manuale dell'admin e non viene mai impostato in automatico.
- Il barbiere legge solo il proprio profilo e quelli dei clienti con una prenotazione con lui. Per cercare un cliente usa `search_customers(q)`: riservata allo staff, restituisce solo id, nome e telefono, almeno 3 caratteri, al massimo 10 risultati, confronto sul telefono sulle sole cifre.

**Prenotazioni**
- Il cliente ha solo `select` sulle proprie prenotazioni. Creazione e cancellazione online arriveranno nella fetta 5 con funzioni `security definer` che applicano SPEC §3.7.2, blocco no-show e limite di cancellazione; una policy di insert diretta permetterebbe di aggirarle.
- Il trigger `bookings_before_write` copia durata e prezzo dal servizio e il buffer dalle impostazioni, e calcola sempre `ends_at = starts_at + durata` e `blocked_until = ends_at + buffer`. I valori passati dal client per questi campi vengono sovrascritti.
- In update durata e prezzo si ricopiano solo se cambia `service_id`; il buffer resta quello della creazione. Durata, prezzo e buffer non sono modificabili a mano, nemmeno dall'admin.
- Vincolo di esclusione su `(barber_id, tstzrange(starts_at, blocked_until, '[)'))` per le sole `confirmed`: copre anche il buffer e non ammette deroghe, nemmeno per le manuali o per il ritorno a `confirmed`.
- Il barbiere deve essere abilitato al servizio, in insert e in update di `barber_id` o `service_id`.
- "Cliente registrato oppure nominativo + telefono" è validato da un trigger su insert e su update di `guest_name` / `guest_phone`, non da un `CHECK`: così il `set null` di `customer_id` passa quando il cliente elimina l'account.
- Transizioni di stato: il barbiere può portare una propria prenotazione da `confirmed` solo a `completed`, `no_show` o `cancelled_by_shop`, e non può modificare barbiere, servizio, cliente, orario, prezzo, durata, buffer o `source`. L'admin può fare qualsiasi transizione, inclusa l'uscita dagli stati finali. Per tutti, `completed` e `no_show` sono ammessi solo se `starts_at` è nel passato: vale in creazione, al cambio di stato e quando si sposta l'orario.
- In creazione il barbiere può inserire solo prenotazioni `confirmed`; admin e ruoli di servizio possono inserire anche altri stati (es. storico), e una prenotazione inserita già `no_show` incrementa il contatore.
- `status_changed_at` e `status_changed_by` sono valorizzati dal trigger: alla creazione (`created_at` e utente corrente) e a ogni cambio di stato. Il client non può modificarli; l'unica eccezione è l'azzeramento di `status_changed_by` fatto dalla chiave esterna quando l'account viene eliminato.

**Chiavi esterne**
- `bookings.customer_id` e `bookings.status_changed_by`: `on delete set null`.
- `bookings.barber_id` e `bookings.service_id`: `on delete restrict`. Servizi e barbieri con prenotazioni si disattivano, non si eliminano.
- `barbers.profile_id`: `on delete set null`. Eliminando l'account staff il barbiere resta, con il suo storico, e diventa un barbiere senza account; con `restrict` l'account non sarebbe eliminabile, con `cascade` l'eliminazione fallirebbe comunque per via delle prenotazioni.

**Visibilità**
- `anon` e `customer`: impostazioni negozio, servizi e barbieri attivi, `barber_services`. Nessun accesso a `working_hours`, `time_off`, `shop_closures`: la disponibilità passerà dal motore lato server.
- Staff: catalogo completo (anche disattivati), tutte le `working_hours` e le chiusure in sola lettura. Il barbiere gestisce solo le proprie `time_off`, senza approvazione.

## Conseguenze

- Gli invarianti valgono per qualunque percorso di scrittura, incluse le future funzioni `security definer` e la `service_role`.
- I trigger di `bookings` sono `security invoker` e distinguono gli utenti da `current_user = 'authenticated'`: le funzioni `security definer` della fetta 5 girano come proprietario e non sono soggette ai limiti del barbiere, quindi dovranno ricontrollare da sole ruolo e regole.
- I tipi generati chiedono in insert anche i campi calcolati dal trigger (`ends_at`, `duration_min`, `price_cents`, `buffer_min`, `blocked_until`, `status_changed_at`), perché sono `not null` senza default: il codice applicativo dovrà passare valori segnaposto o usare funzioni dedicate.
- SPEC §3.7.2 (fascia di lavoro, assenze, anticipo, orizzonte) non ha ancora vincoli nel database: arriva con le funzioni di prenotazione della fetta 5.
- La concorrenza reale fra due sessioni non è verificabile in pgTAP; è verificato il vincolo di esclusione, che la gestisce.
- Il seed crea utenti demo con password nota e gira solo in locale e in CI.
