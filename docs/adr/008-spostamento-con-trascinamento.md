# ADR 008 – Spostamento delle prenotazioni con il trascinamento

Data: 2026-10-07 · Stato: accettata · Fetta 6c

## Contesto

Con la fetta 6 lo spostamento (SPEC §6.3) passava solo dal modulo di modifica del dettaglio, riservato all'admin. In negozio gli spostamenti sono frequenti (il cliente telefona per anticipare o posticipare) e vanno fatti in fretta, anche da tablet o telefono, e anche dal barbiere sui propri appuntamenti. Il database vietava al barbiere qualsiasi cambio di orario.

## Decisione

**Chi sposta cosa**
- Si spostano solo le prenotazioni `confirmed` non ancora iniziate (`starts_at > now`; l'inizio esatto conta come iniziata). La destinazione può essere nel passato, con l'avviso `past`.
- Admin: qualunque prenotazione, anche verso un'altra colonna, purché il barbiere di arrivo sia attivo. Nella propria colonna si sposta anche una prenotazione di un barbiere disattivato.
- Barbiere (non admin): solo le proprie e solo nell'orario, nella propria colonna. Un admin che è anche barbiere vale come admin.
- Durata e prezzo non cambiano mai spostando (CLAUDE.md regola 4).

**Database**
- `bookings_before_write` consente al barbiere di cambiare `starts_at` solo se `old.status = 'confirmed'`, lo stato non cambia nello stesso update e `old.starts_at > now()`. Restano vietati barbiere, servizio, cliente, durata, prezzo, buffer, `source`. Fine e buffer li ricalcola il trigger; i vincoli di esclusione (barbiere con buffer, cliente) valgono anche qui. RLS invariata.

**Server action `moveBooking`**
- Input come oggetto (non FormData), validato con `moveBookingSchema`: `id`, `barberId`, `startsAt` e la posizione attesa `expectedBarberId`/`expectedStartsAt` (ISO con offset), `confirmedWarnings`.
- Se la prenotazione non è più nella posizione attesa, o non è più `confirmed`, l'esito è `stale` (decisione dell'utente: anche lo stato cambiato è "dati cambiati nel frattempo"). L'update è filtrato su stato, barbiere e inizio letti, così due spostamenti concorrenti non si sovrascrivono.
- Avvisi (fuori fascia, assenza, chiusura, passato) ricalcolati a ogni invio, come nella fetta 6. Con `saved` il server restituisce `previousWarnings`, gli avvisi della posizione di partenza.
- Il modulo "Sposta orario" del dettaglio (`moveBookingFromForm`) è l'alternativa accessibile per il barbiere: data e ora locali, stessa logica. Non c'è un sensore da tastiera sul calendario.

**Interfaccia**
- `@dnd-kit/core` nella sola vista giorno. Mouse dopo 5 px; al tocco pressione prolungata di 250 ms (tolleranza 5 px). Le schede trascinabili non mostrano il menu del link né selezionano il testo (`-webkit-touch-callout: none`, `user-select: none`).
- Aggancio alle righe della griglia (`slot_granularity_min`): lo scarto si conta in righe reali, quindi nei giorni del cambio d'ora l'ora ripetuta resta raggiungibile e quella saltata non esiste.
- Spostamento ottimistico: la scheda va subito al nuovo posto e torna indietro se il server rifiuta, con il messaggio dell'errore.
- Avvisi in un `AlertDialog` (`role="alertdialog"`) con "Annulla" e "Conferma comunque".
- Dopo il salvataggio, "Annulla spostamento" per 8 secondi: richiama `moveBooking` all'indietro con `previousWarnings` già confermati. Se nel frattempo compare un avviso nuovo (es. un'assenza sull'orario di partenza) si chiede di nuovo conferma.
- Esiti annunciati in una regione `role="status"`.
- dnd-kit ferma la propagazione del click che segue il rilascio, ma non la sua azione predefinita: la scheda è un link al dettaglio, quindi un listener nativo in cattura annulla quel solo click.

## Conseguenze

- Il barbiere può riorganizzare la propria giornata senza passare dall'admin; il database resta l'ultima garanzia.
- Notifica al cliente dello spostamento (anche da trascinamento e annullamento): da fare nella fetta 7.
- Il touch va verificato a mano su un dispositivo o una viewport iPhone: gli e2e usano il mouse.
