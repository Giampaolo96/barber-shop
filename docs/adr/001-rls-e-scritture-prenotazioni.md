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
- I trigger di guardia lasciano passare solo i ruoli di servizio (seed, migrazioni, `service_role`) e le funzioni `security definer`, riconosciuti da `current_user`. Non c'è un bypass per profondità dei trigger: il contatore no-show passa perché la sua funzione è `security definer`.
- `no_show_count` segue le prenotazioni: una prenotazione conta per un cliente quando esiste, è `no_show` ed è intestata a lui. +1 entrando in `no_show`, -1 uscendo, mai sotto zero; cambiando `customer_id` di una `no_show` il conteggio si sposta dal vecchio al nuovo cliente; eliminando una `no_show` il conteggio scende.
- Deve restare sempre almeno un admin attivo (ruolo admin e non bloccato): l'ultimo non può essere declassato, bloccato né eliminato. Gli admin bloccati non contano.
- All'eliminazione di un profilo, le sue prenotazioni future ancora `confirmed` vengono cancellate (trigger `before delete`) prima che la chiave esterna azzeri `customer_id`: lo slot torna libero. Lo stato dice chi ha eliminato l'account: `cancelled_by_customer` se è l'utente stesso, `cancelled_by_shop` se è un altro utente (l'admin). Senza utente identificato (`service_role` senza JWT) vale `cancelled_by_customer`. Le prenotazioni passate non cambiano stato.
- **Blocco per no-show**: il blocco automatico (fetta 5) si calcola confrontando `no_show_count` con `no_show_block_threshold` al momento della prenotazione. `is_blocked` resta solo il blocco manuale dell'admin e non viene mai impostato in automatico.
- Il barbiere legge solo il proprio profilo e quelli, con ruolo `customer`, dei clienti con una prenotazione con lui: un cliente promosso a staff non gli è più leggibile. Per cercare un cliente usa `search_customers(q)`: riservata allo staff, restituisce solo id, nome e telefono, almeno 3 caratteri, al massimo 10 risultati, confronto sul telefono sulle sole cifre.

**Prenotazioni**
- Il cliente ha solo `select` sulle proprie prenotazioni. Creazione e cancellazione online arriveranno nella fetta 5 con funzioni `security definer` che applicano SPEC §3.7.2, blocco no-show e limite di cancellazione; una policy di insert diretta permetterebbe di aggirarle.
- Il trigger `bookings_before_write` copia durata e prezzo dal servizio e il buffer dalle impostazioni, e calcola sempre `ends_at = starts_at + durata` e `blocked_until = ends_at + buffer`. I valori passati dal client per questi campi vengono sovrascritti.
- In update durata e prezzo si ricopiano se cambia `service_id`. L'admin può anche modificarli a mano (sconto, appuntamento più lungo): la nuova durata ricalcola `ends_at` e `blocked_until` e resta soggetta al vincolo di esclusione. Il barbiere non può. Il buffer resta sempre quello della creazione.
- `id` e `created_at` sono immutabili per tutti; in insert gli utenti non scelgono `created_at`.
- `customer_id` deve puntare a un profilo con ruolo `customer`: una prenotazione intestata a un profilo staff lo renderebbe leggibile al barbiere.
- Vincolo di esclusione su `(barber_id, tstzrange(starts_at, blocked_until, '[)'))` per le sole `confirmed`: copre anche il buffer e non ammette deroghe, nemmeno per le manuali o per il ritorno a `confirmed`.
- (Fetta 6, ADR 006) Secondo vincolo di esclusione `bookings_customer_no_overlap` su `(customer_id, tstzrange(starts_at, ends_at, '[)'))` per le sole `confirmed` con cliente registrato (SPEC §3.7.6): vale per tutti i percorsi, senza buffer; gli ospiti sono esclusi.
- Il barbiere deve essere abilitato al servizio, in insert e in update di `barber_id` o `service_id`.
- "Cliente registrato oppure nominativo + telefono" è validato da un trigger su insert e su update di `guest_name` / `guest_phone`, non da un `CHECK`: così il `set null` di `customer_id` passa quando il cliente elimina l'account.
- Transizioni di stato: il barbiere può portare una propria prenotazione da `confirmed` solo a `completed`, `no_show`, `cancelled_by_customer` (dalla fetta 6: disdetta telefonica del cliente) o `cancelled_by_shop`, e non può modificare barbiere, servizio, cliente, orario, prezzo, durata, buffer o `source`; può correggere nominativo e telefono dell'ospite. L'admin può fare qualsiasi transizione, inclusa l'uscita dagli stati finali. Per tutti, `completed` e `no_show` sono ammessi solo se `starts_at` è nel passato: vale in creazione, al cambio di stato e quando si sposta l'orario.
- In creazione il barbiere può inserire solo prenotazioni `confirmed`; admin e ruoli di servizio possono inserire anche altri stati (es. storico), e una prenotazione inserita già `no_show` incrementa il contatore.
- Solo l'admin può eliminare una prenotazione; barbiere e cliente no.
- `bookings.notes` è la nota visibile al cliente. Le note interne dello staff stanno nella tabella separata `booking_staff_notes` (una riga per prenotazione, `updated_at` e `updated_by` valorizzati dal database), con RLS solo staff: il barbiere sulle proprie prenotazioni, l'admin su tutte. Una colonna di `bookings` sarebbe leggibile anche dal cliente, perché cliente e staff condividono lo stesso ruolo Postgres.
- La nota staff segue la prenotazione: se l'admin la riassegna a un altro barbiere, il nuovo barbiere legge e modifica la nota scritta dal precedente. È il comportamento voluto.
- `status_changed_at` e `status_changed_by` sono valorizzati dal trigger: alla creazione (`created_at` e utente corrente) e a ogni cambio di stato. Il client non può modificarli; l'unica eccezione è l'azzeramento di `status_changed_by` fatto dalla chiave esterna quando l'account viene eliminato.

**Chiavi esterne**
- `bookings.customer_id`, `bookings.status_changed_by` e `booking_staff_notes.updated_by`: `on delete set null`. `booking_staff_notes.booking_id`: `on delete cascade`.
- `bookings.barber_id` e `bookings.service_id`: `on delete restrict`. Servizi e barbieri con prenotazioni si disattivano, non si eliminano.
- `barbers.profile_id`: `on delete set null`. Eliminando l'account staff il barbiere resta, con il suo storico, e diventa un barbiere senza account; con `restrict` l'account non sarebbe eliminabile, con `cascade` l'eliminazione fallirebbe comunque per via delle prenotazioni.

**Visibilità**
- `anon` e `customer`: impostazioni negozio, servizi e barbieri attivi, e le coppie di `barber_services` in cui servizio e barbiere sono entrambi attivi. `barbers.profile_id` è leggibile solo dallo staff, tramite la funzione `barber_accounts()`: `anon` e `authenticated` hanno il grant di lettura solo sulle colonne pubbliche di `barbers`, perché clienti e staff condividono lo stesso ruolo Postgres. Su `barbers` quindi `select *` fallisce: le colonne vanno elencate, e ogni colonna nuova richiede un grant. Nessun accesso a `working_hours`, `time_off`, `shop_closures`: la disponibilità passerà dal motore lato server.
- Staff: catalogo completo (anche disattivati), tutte le `working_hours` e le chiusure in sola lettura. Il barbiere gestisce solo le proprie `time_off`, senza approvazione.

**Privilegi di default**
- Nello schema `public` tabelle e sequenze nuove nascono senza privilegi per `anon`, `authenticated` e `PUBLIC` (`alter default privileges in schema public`): ogni migrazione concede solo grant espliciti. Vale per gli oggetti creati dalle migrazioni (ruolo `postgres`); i default del ruolo `supabase_admin` non sono toccati e riguardano solo oggetti creati fuori dalle migrazioni.
- Per le funzioni i default tolgono solo i grant automatici ad `anon` e `authenticated`: `EXECUTE` a `PUBLIC` è un default globale di Postgres che un revoke per schema non tocca, e revocarlo globalmente toglierebbe l'esecuzione anche alle funzioni degli altri schemi e a quelle temporanee. Regola: ogni migrazione che crea una funzione fa un `revoke` esplicito da `public`, `anon` e `authenticated`, poi concede solo i grant voluti.
- Un test pgTAP verifica che nessuna funzione di `public` sia eseguibile da `PUBLIC` o `anon`, salvo un elenco esplicito: gli helper delle policy (`current_user_role`, `is_admin`, `is_staff`, `current_barber_id`), che `anon` deve poter chiamare per leggere il catalogo, e i costruttori del tipo range `timerange` / `timemultirange`, che Postgres crea con il tipo come funzioni del superutente e che una migrazione non può revocare (non leggono dati).
- Le funzioni dei trigger non hanno grant. `search_customers` è eseguibile solo da `authenticated` (non serve a `service_role`: senza utente rifiuta sempre).
- `shop_settings.timezone` è validato contro `pg_timezone_names` senza distinguere maiuscole e minuscole, e salvato nella forma canonica (`europe/rome` diventa `Europe/Rome`).

## Conseguenze

- Gli invarianti valgono per qualunque percorso di scrittura, incluse le future funzioni `security definer` e la `service_role`.
- I trigger di `bookings` sono `security invoker` e distinguono gli utenti da `current_user = 'authenticated'`: le funzioni `security definer` della fetta 5 girano come proprietario e non sono soggette ai limiti del barbiere, quindi dovranno ricontrollare da sole ruolo e regole.
- I tipi generati chiedono in insert anche i campi calcolati dal trigger (`ends_at`, `duration_min`, `price_cents`, `buffer_min`, `blocked_until`, `status_changed_at`), perché sono `not null` senza default: il codice applicativo dovrà passare valori segnaposto o usare funzioni dedicate.
- SPEC §3.7.2 (fascia di lavoro, assenze, anticipo, orizzonte) non ha ancora vincoli nel database: arriva con le funzioni di prenotazione della fetta 5.
- La concorrenza reale fra due sessioni non è verificabile in pgTAP; è verificato il vincolo di esclusione, che la gestisce.
- Il seed crea utenti demo con password nota e gira solo in locale e in CI; non va mai applicato al cloud (`supabase db push --include-seed`).
- La protezione dell'ultimo admin vale per tutti i percorsi, anche per i ruoli di servizio: per sostituire l'unico admin va prima promosso il nuovo.
- Eliminazione account (fetta 9): se la server action elimina l'utente con la `service_role` senza JWT dell'utente, il database non sa chi agisce e marca le prenotazioni future come `cancelled_by_customer`. Quando è l'admin a eliminare un cliente per questa via, la server action deve prima cancellare le prenotazioni con `cancelled_by_shop`.
