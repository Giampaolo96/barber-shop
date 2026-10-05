# ADR 006 – Calendario dello staff e prenotazioni manuali

Data: 2026-10-05 · Stato: accettata · Fetta 6

## Contesto

La fetta 6 porta in `/admin` il calendario (SPEC §6.1), le prenotazioni manuali (§6.2), lo spostamento (§6.3) e i cambi di stato. Restavano aperti alcuni punti:
- le manuali possono derogare alla regola 2 (§3.7.5), ma la SPEC non diceva come;
- la regola 6 (nessuna sovrapposizione per lo stesso cliente) era controllata solo da `create_online_booking`;
- il barbiere non aveva modo di registrare la disdetta telefonica di un cliente;
- la sezione Clienti (§6.7), rimandata dalla fetta 3, avrebbe raddoppiato la fetta.

## Decisione

**Database**
- Vincolo di esclusione `bookings_customer_no_overlap` su `(customer_id, tstzrange(starts_at, ends_at, '[)'))`, solo con `status = 'confirmed'` e `customer_id` valorizzato, senza buffer.
  - Vale per tutti i percorsi: manuali, spostamenti, ripristino a `confirmed`, online.
  - Le prenotazioni intestate a un ospite sono escluse: lo stesso nome e telefono non identificano una persona.
  - `create_online_booking` mantiene il proprio controllo, che restituisce `customer_overlap`.
- `bookings_before_write`: il barbiere può portare una propria prenotazione da `confirmed` anche a `cancelled_by_customer`. Tutto il resto resta come nell'ADR 001.

**Avvisi e conferma** (§3.7.5)
- Per una manuale o uno spostamento il server calcola gli avvisi sui dati attuali:
  - `outside_hours`: `[starts_at, ends_at)` non sta in una fascia, con le fasce contigue unite;
  - `time_off`: sovrapposizione con un'assenza del barbiere;
  - `closure`: sovrapposizione con una chiusura;
  - `past`: `starts_at < now`.
- Al primo invio non si salva e si mostrano gli avvisi. "Conferma comunque" invia quelli mostrati (`shownWarnings` + `confirm=1`).
- A ogni invio gli avvisi si ricalcolano. Si salva solo se quelli attuali sono un sottoinsieme, anche vuoto, di quelli confermati; se ne compare uno nuovo si mostrano gli attuali e non si salva (`decideWarnings`).
- La conferma non tocca mai le sovrapposizioni del barbiere e del cliente: le rifiuta il database (`23P01`), e l'interfaccia distingue i due vincoli dal nome.
- Nella modifica dell'admin gli avvisi valgono solo se cambiano orario, barbiere o fine di una prenotazione `confirmed`. Cambiare solo il prezzo, o modificare una prenotazione passata o chiusa, non chiede conferme.

**Modifica (solo admin)**
- Si possono cambiare barbiere, servizio, data e ora, durata e prezzo.
- Cambiando servizio, durata e prezzo li ricopia il database dal nuovo servizio: quelli del modulo non vengono inviati (`bookingUpdateValues`).
- Il cliente non si cambia dal modulo.

**Cambi di stato** (`allowedTransitions`, ricontrollati dalla server action e dal trigger)
- Da `confirmed`, per barbiere e admin:
  - `completed` e `no_show` solo se `starts_at <= now`;
  - `cancelled_by_customer` e `cancelled_by_shop` sempre.
- Dagli stati finali il barbiere non fa nulla; l'admin può solo "Ripristina confermata", soggetta a entrambi i vincoli.
- L'aggiornamento è condizionato allo stato letto: due cambi concorrenti non si sovrascrivono.
- Nessuna eliminazione dall'interfaccia: basta la cancellazione.

**Calendario**
- **Vista giorno** (`/admin?data=&vista=giorno`): una colonna per barbiere.
  - L'admin vede i barbieri attivi e quelli disattivati con prenotazioni nel giorno; il barbiere solo la propria scheda.
  - La griglia segue la granularità del negozio, dalla prima fascia o prenotazione all'ultima, con ripiego 09:00–19:00. Le righe sono istanti reali: nei giorni del cambio d'ora un'ora manca o si ripete.
  - Ogni riga libera è un link a `/admin/calendario/nuova` precompilato.
  - Fuori fascia, assenze e chiusure sono solo sfondo.
- **Vista settimana**: un barbiere alla volta. Per il barbiere è sempre la sua scheda e `?barbiere=` viene ignorato. Per l'admin è quello scelto, altrimenti `defaultWeekBarber`: la propria scheda se attiva, poi il primo barbiere attivo per nome.
- **Cancellate**: nascoste, con un conteggio e il link `?cancellate=1`.
- **Dettaglio** `/admin/calendario/<id>`: id non uuid o prenotazione non visibile per la RLS → 404. Mostra stato, nota interna e, per l'admin, il modulo di modifica.
- Tutte le letture usano il client dell'utente (RLS). Nessuna service role.

**Moduli**
- Nella manuale c'è solo la nota interna (`booking_staff_notes`); `bookings.notes` resta del cliente.
- Ospite: nome (1–100) e telefono in E.164, con lo schema del profilo. Orario con passo di 5 minuti.
- Dopo avvisi o errori il modulo riparte dai valori inviati e si rimonta (`key`). Il reset automatico di React dopo un'azione riporterebbe select e radio alla scelta del primo rendering, e "Conferma comunque" invierebbe un altro servizio.

**Clienti** (§6.7): spostati nella fetta 6b (SPEC §11). Lì va deciso anche come l'admin toglie un blocco automatico per no-show.

## Conseguenze

- La nota interna di una manuale si salva dopo la prenotazione, non nella stessa transazione. Se fallisce, la prenotazione resta e lo staff reinserisce la nota dal dettaglio; l'errore va nel log.
- Una gara fra una manuale dello staff e una prenotazione online dello stesso cliente fa scattare il nuovo vincolo dentro `create_online_booking`. Il cliente vede allora "Orario appena occupato" invece del messaggio sulla propria sovrapposizione: il caso è raro e accettato.
- Il layout di `/admin` ha `min-w-0` su `<main>`: con molti barbieri il calendario scorre orizzontalmente nel proprio contenitore, senza allargare la pagina.
