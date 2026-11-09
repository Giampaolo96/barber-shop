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
- Limiti noti, accettati perché riguardano la notte o la domenica sera, con il negozio chiuso:
  - nei giorni del cambio d'ora la linea dell'ora attuale è sfasata di un'ora se l'asse parte prima delle 02:00–03:00 (`weekNowLine` conta minuti reali, l'asse segue l'orologio);
  - a cavallo fra due settimane il conteggio delle cancellate include quelle iniziate la domenica sera precedente (non mostrate), e una confermata iniziata domenica sera e finita dopo la mezzanotte non segna occupate le prime righe del lunedì. Il server rifiuta comunque lo slot.
- Sui dispositivi touch (`pointer: coarse`) le intestazioni dei giorni sono alte 44 px, così il link alla vista giorno ha un'area di tocco adeguata senza coprire la prima riga; su desktop restano compatte.
- Nessun `touch-action: none`: il dito scorre il contenitore, il trascinamento parte solo dopo la pressione di 250 ms; le schede trascinabili hanno `touch-action: manipulation`.
- Giorni di chiusura settimanale fissa nascosti (modifica successiva alla 8c): una colonna non si disegna se il negozio non ha orari in quel giorno della settimana (`shop_opening_hours`, la stessa fonte degli orari della home: unione delle fasce dei barbieri attivi), salvo prenotazioni da mostrare in quella data (non cancellate, o cancellate con "mostra cancellate"). La regola è la funzione pura `visibleWeekDays` in `week-grid.ts`; nessun giorno è scritto nel codice. Le chiusure straordinarie non nascondono la colonna: resta attenuata con la sua etichetta. Settimana, URL, navigazione e query restano da lunedì a domenica: cambia solo cosa si disegna, e l'asse delle righe si calcola sui giorni disegnati. Le colonne visibili si allargano (`minmax(7rem, 1fr)`); su desktop stanno tutte senza scorrimento orizzontale. Per un appuntamento eccezionale in un giorno nascosto si passa dalla vista giorno, che non cambia; trascinare verso un giorno nascosto non è possibile.
- Se oggi è nascosto (o fuori settimana) il contenitore parte dalla prima colonna e la linea dell'ora non si disegna (`initialWeekColumn`, `weekNowLine` sui soli giorni disegnati).

## Conseguenze

- Il barbiere può riorganizzare la propria giornata senza passare dall'admin; il database resta l'ultima garanzia.
- Notifica al cliente dello spostamento (anche da trascinamento e annullamento): da fare nella fetta 7.
- Il touch va verificato a mano su un dispositivo o una viewport iPhone: gli e2e usano il mouse.

## Aggiornamento (fetta 8h, 2026-11-09): niente cambio di giorno durante uno spostamento

**Contesto.** Il test e2e "se il server rifiuta uno spostamento dopo un cambio di giorno…" (8j) falliva ogni tanto, anche sulla build di produzione: dopo il clic su "Giorno successivo" con la risposta di `moveBooking` trattenuta, l'avviso non arrivava mai. La trace mostra una GET del documento completo (`/admin?data=…`, senza `_rsc`).

Comportamento di Next 16.4.3, verificato nei sorgenti in `node_modules/next/dist/client/components/`:
- `app-router-instance.js`, `dispatchAction`: una navigazione (o un back/forward) che arriva con un'azione in corso ha la precedenza. L'azione in corso è marcata `discarded` e la navigazione parte subito.
- `runAction` → `handleResult`: se l'azione è `discarded`, il suo stato non si applica e la promise del chiamante non viene né risolta né rifiutata. L'`await moveBooking(…)` del client resta in sospeso per sempre, quindi né l'esito né l'errore arrivano all'interfaccia. Se l'azione aveva rivalidato dati, si fa solo un `refresh` a coda vuota.
- `app-router-state.js` (`navigate` → `completeHardNavigation`) e `render-tree.js`: quando la navigazione SPA non riesce (richiesta RSC fallita, redirect, albero non coerente), Next ripiega su una navigazione completa del documento (MPA), che azzera lo stato del client. È la GET senza `_rsc` della trace.

**Decisione.** Mentre uno spostamento aspetta il server, la barra del calendario non naviga. Frecce, "Oggi", Giorno/Settimana e selettore del barbiere diventano `aria-disabled` e il clic non fa nulla (`CalendarNavLink` e `setMoveBusy` in `move-lock.tsx`, collegati a `busy` di `useBookingMove`). Tornano attivi all'esito, positivo o di errore. Se la risposta non arriva entro 15 s (`MOVE_TIMEOUT_MS`), la scheda torna al suo posto, i comandi si riattivano e compare l'errore `move.timeout` con "Chiudi"; un'eventuale risposta tardiva si ignora. Il server non cambia. Scorciatoie da tastiera per cambiare giorno non ne esistono.

**Conseguenze.** Restano possibili le navigazioni fuori dalla barra (link delle schede, "Nuova prenotazione", "mostra cancellate", menu, indietro del browser): scartano lo spostamento in corso come prima. Dopo un timeout lo stato reale si vede ricaricando la pagina.
