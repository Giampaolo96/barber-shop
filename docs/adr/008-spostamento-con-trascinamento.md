# ADR 008 – Spostamento delle prenotazioni con il trascinamento

Data: 2026-10-07 · Stato: accettata · Fetta 6c

## Contesto

Con la fetta 6 lo spostamento (SPEC §6.3) passava solo dal modulo di modifica del dettaglio, riservato all'admin. In negozio gli spostamenti sono frequenti (il cliente telefona per anticipare o posticipare) e vanno fatti in fretta, anche da tablet o telefono, e anche dal barbiere sui propri appuntamenti. Il database vietava al barbiere qualsiasi cambio di orario.

## Decisione

**Chi sposta cosa**
- Si spostano solo le prenotazioni `confirmed` non ancora iniziate (`starts_at > now`; l'inizio esatto conta come iniziata), e solo verso un orario futuro. La destinazione nel passato era ammessa con l'avviso `past` nel piano, poi esclusa dall'utente nella review: né trascinando né con "Sposta orario" (esito `past_target`). Per gli orari passati l'admin usa il modulo di modifica.
- Admin: qualunque prenotazione, anche verso un'altra colonna, purché il barbiere di arrivo sia attivo. Nella propria colonna si sposta anche una prenotazione di un barbiere disattivato.
- Barbiere (non admin): solo le proprie e solo nell'orario, nella propria colonna. Un admin che è anche barbiere vale come admin.
- Durata e prezzo non cambiano mai spostando (CLAUDE.md regola 4).

**Database**
- `bookings_before_write` consente al barbiere di cambiare `starts_at` solo se `old.status = 'confirmed'`, lo stato non cambia nello stesso update, `old.starts_at > now()` e `new.starts_at > now()` (quest'ultima dalla review, migrazione `20261007110000`). Così il barbiere non può portare una prenotazione nel passato per poi segnarla no-show. Restano vietati barbiere, servizio, cliente, durata, prezzo, buffer, `source`. Fine e buffer li ricalcola il trigger; i vincoli di esclusione (barbiere con buffer, cliente) valgono anche qui. RLS invariata.

**Server action `moveBooking`**
- Input come oggetto (non FormData), validato con `moveBookingSchema`: `id`, `barberId`, `startsAt` e la posizione attesa `expectedBarberId`/`expectedStartsAt` (ISO con offset), `confirmedWarnings`.
- Se la prenotazione non è più nella posizione attesa, o non è più `confirmed`, l'esito è `stale` (decisione dell'utente: anche lo stato cambiato è "dati cambiati nel frattempo"). L'update è filtrato su stato, barbiere e inizio letti, così due spostamenti concorrenti non si sovrascrivono.
- Destinazione nel passato → `past_target`, prima degli avvisi e senza deroghe.
- Avvisi (fuori fascia, assenza, chiusura) ricalcolati a ogni invio, come nella fetta 6.
- Un errore nelle letture (prenotazione, scheda propria, barbiere di arrivo) dà `error`, non `forbidden` o `invalid`. Con `saved` il server restituisce `previousWarnings`, gli avvisi della posizione di partenza.
- Il modulo "Sposta orario" del dettaglio (`moveBookingFromForm`) è l'alternativa accessibile per il barbiere: data e ora locali, stessa logica. Non c'è un sensore da tastiera sul calendario.

**Interfaccia**
- `@dnd-kit/core` nelle viste giorno e settimana (la settimana dalla fetta 8c, sotto). Mouse dopo 5 px; al tocco pressione prolungata di 250 ms (tolleranza 5 px). Cosa è trascinabile si mostra con l'ora del server e si ricontrolla con l'ora corrente quando si afferra la scheda. Un rilascio nel passato non chiama il server e mostra il messaggio. Le schede trascinabili non mostrano il menu del link né selezionano il testo (`-webkit-touch-callout: none`, `user-select: none`).
- Rilascio sulla colonna sotto il puntatore (`pointerWithin`), senza ripiego su `rectIntersection`: fuori dalle colonne la prenotazione resta nella propria, che è più sicuro.
- Durante il trascinamento la destinazione è sempre visibile: la colonna di arrivo ha un contorno pieno e la scheda trascinata mostra barbiere e orario di arrivo ("Mario, 10:30"). Anteprima e rilascio usano la stessa funzione pura (`dropTarget`) sugli stessi dati di dnd-kit, che tengono conto dello scorrimento: quello che si vede è quello che si salva, anche durante l'autoscroll.
- Autoscroll solo vicino ai bordi estremi (5% in orizzontale, 20% in verticale): serve a raggiungere le colonne fuori schermo, ma non fa scorrere la griglia sotto un puntatore fermo su una colonna visibile (causa di un e2e instabile con molti barbieri).
- Si trascina una copia della scheda (`DragOverlay`), mentre l'originale resta al suo posto tratteggiata. Spostare l'originale con un `transform` dentro il contenitore che scorre ne allargava l'area: l'autoscroll verso destra non finiva mai.
- Aggancio alle righe della griglia (`slot_granularity_min`): lo scarto si conta in righe reali, quindi nei giorni del cambio d'ora l'ora ripetuta resta raggiungibile e quella saltata non esiste.
- Spostamento ottimistico: la scheda va subito al nuovo posto e torna indietro se il server rifiuta, con il messaggio dell'errore.
- Avvisi in un `AlertDialog` (`role="alertdialog"`) con "Annulla" e "Conferma comunque".
- Dopo il salvataggio, "Annulla spostamento" per 8 secondi: richiama `moveBooking` all'indietro con `previousWarnings` già confermati. Se nel frattempo compare un avviso nuovo (es. un'assenza sull'orario di partenza) si chiede di nuovo conferma.
- Esiti annunciati in una regione `role="status"`.
- dnd-kit ferma la propagazione del click che segue il rilascio, ma non la sua azione predefinita: la scheda è un link al dettaglio, quindi un listener nativo in cattura annulla quel solo click.

**Vista settimana (fetta 8c)**
- Stessi sensori, stesso blocco del click, stessa copia trascinata e stesso `useBookingMove`: le parti comuni stanno in `grid-parts.tsx` e `use-calendar-drag.ts`, la vista giorno le usa senza cambiare comportamento.
- La destinazione è il giorno della colonna sotto il puntatore e la riga di arrivo, sempre per lo stesso barbiere (`weekDropTarget` in `week-grid.ts`, la stessa per anteprima e rilascio). Stessi permessi e stesse risposte del server della vista giorno; l'anteprima mostra giorno e orario ("gio 15 ott, 10:30").
- Le righe sono un asse comune ai 7 giorni sull'orologio locale: l'istante di una riga si calcola per ogni giorno. Le ore saltate dall'ora legale non sono cliccabili né destinazioni; l'ora ripetuta del ritorno all'ora solare compare una volta (prima occorrenza): limite noto, riguarda solo la notte.
- La griglia scorre in entrambe le direzioni nel proprio contenitore (alto al massimo `100dvh` meno lo spazio della barra), con colonna delle ore e intestazioni dei giorni `sticky`. Con lo scorrimento anche orizzontale la destinazione resta visibile così: autoscroll solo ai bordi estremi come nella vista giorno, e una collision detection che restituisce "nessuna destinazione" quando il puntatore è fuori dal contenitore o sopra la colonna delle ore o le intestazioni, che coprono le colonne che ci scorrono sotto. Si rilascia solo su ciò che si vede.
- Nessun `touch-action: none`: il dito scorre il contenitore, il trascinamento parte solo dopo la pressione di 250 ms; le schede trascinabili hanno `touch-action: manipulation`.

## Conseguenze

- Il barbiere può riorganizzare la propria giornata senza passare dall'admin; il database resta l'ultima garanzia.
- Notifica al cliente dello spostamento (anche da trascinamento e annullamento): da fare nella fetta 7.
- Il touch va verificato a mano su un dispositivo o una viewport iPhone: gli e2e usano il mouse.
