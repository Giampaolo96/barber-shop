# ADR 012 – Passo "Quando?" della prenotazione

Data: 2026-10-16 · Stato: accettata · Fetta 8e · Aggiorna il flusso di SPEC §5.2 (da 4 a 3 schermate)

## Contesto

Fino alla fetta 8d il cliente sceglieva servizio → barbiere (o "Nessuna preferenza") → giorno e orario → conferma. Al telefono il passo del barbiere costava un tocco in più e nascondeva gli orari degli altri barbieri. Il nuovo passo "Quando?" mostra, per il giorno scelto, gli orari liberi di tutti i barbieri del servizio. Andavano decisi:
- quanti dati leggere all'apertura e a ogni cambio di giorno;
- come scegliere il barbiere del "Primo libero" senza dare al client dati di altre prenotazioni (CLAUDE.md regola 6);
- cosa conta come giorno "chiuso" e come "senza posti";
- cosa fare dei vecchi URL e della scelta "qualsiasi barbiere".

## Decisione

**Motore** (`src/lib/availability/`, funzioni pure, nessuna regola nuova)
- `dayStatuses`: "closed" se nessun barbiere del servizio ha tempo di lavoro al netto di chiusure e assenze (indipendente da prenotazioni e da `now`), "open" con almeno uno slot, altrimenti "full".
- `nextSlotByBarber`: primo slot di ogni barbiere nei giorni dopo quello scelto, fino all'ultimo giorno prenotabile.
- `firstFree`: primo orario del giorno fra tutti i barbieri; a parità vince il preferito libero a quell'ora (barbiere arrivato dall'URL, poi barbiere dell'ultimo appuntamento), altrimenti `pickBarber` di ADR 004 con i conteggi delle prenotazioni confirmed (intervalli `busy`) che iniziano quel giorno. Il conteggio usa i dati che `availability_inputs` dà già e resta sul server: al client arriva solo il barbiere scelto.

**Dati**
- Apertura (`getWhenOverview`, server component): una lettura di `availability_inputs` per l'intero periodo prenotabile, da oggi a oggi + `max_horizon_days`. In locale, con il seed e 31 giorni: circa 18 KB e 17–27 ms fra database e server. Questi dati non arrivano al telefono; servono per lo stato dei giorni della striscia, il giorno iniziale, gli orari del primo giorno e il prossimo orario dei barbieri pieni.
- Cambio di giorno (`fetchWhenDay`, server action): una lettura dal giorno scelto all'ultimo giorno prenotabile, perché il "prossimo orario libero" dei barbieri pieni guarda i giorni successivi. Al client torna solo il giorno: per ogni barbiere orari e prossimo orario, più il "Primo libero". Rileggere il resto del periodo costa pochi millisecondi e tiene il "prossimo orario" aggiornato. Input validato con Zod; giorno fuori dal periodo prenotabile → `invalid`.
- Il barbiere dell'ultimo appuntamento lo legge il server dalla sessione, con la RLS (solo le prenotazioni del cliente): ultimo appuntamento già iniziato, escluse le cancellate.
- Nel client: i giorni già visti restano in memoria, il giorno selezionabile successivo si prepara in anticipo. Durante il caricamento si vedono gli scheletri con lo stesso numero di righe del giorno precedente, e il blocco "Primo libero" ha un'altezza fissa, così le sezioni non si spostano.

**Accesso**: come le altre pagine del flusso (SPEC §5.3, §5.5): login e profilo completo; il cliente bloccato vede l'avviso già su "Quando?".

**Vecchi URL**: `/prenota/barbiere` e `/prenota/orario` fanno redirect (`legacyWhenUrl`) a "Quando?" con servizio, barbiere (solo un id) e giorno validi. Il riepilogo accetta ancora `barbiere=any` dai vecchi link: lì il barbiere lo sceglie il database come prima (`create_online_booking(null)`).

## Conseguenze

- Il flusso ha 3 schermate. "Nessuna preferenza" sparisce dall'interfaccia ma la regola di assegnazione di ADR 004 resta, nel database e nel "Primo libero".
- Il "Primo libero" usa le prenotazioni confirmed, il database (per "qualsiasi") tutte le non cancellate: in casi rari i due possono scegliere barbieri diversi. Non è un problema, perché il "Primo libero" porta al riepilogo con un barbiere preciso, che il database ricontrolla alla conferma.
- Le server action di Next sono eseguite una alla volta per client: se il cliente tocca un giorno mentre il prefetch del successivo è in corso, la sua richiesta aspetta quella. Si prepara un solo giorno alla volta per contenere l'attesa.
- `getAvailableSlots` / `getAvailableDays` e le relative action restano per i test e per eventuali usi futuri; il flusso cliente non le usa più.
- `availability_inputs` taglia gli intervalli a `now()`: oggi, dopo l'ultima fascia, il giorno risulta "chiuso" anziché "senza posti", e nei conteggi del "Primo libero" di oggi mancano le prenotazioni già finite. Aperto in PROGRESS, da decidere.
