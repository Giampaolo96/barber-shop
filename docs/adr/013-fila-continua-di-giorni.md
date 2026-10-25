# ADR 013 – "Quando?" a fila continua di giorni

Data: 2026-10-25 · Stato: accettata · Fetta 8f · Aggiorna ADR 012 (passo "Quando?") e SPEC §5.2 · Dati, coda delle richieste, "Primo libero" e ridimensionamento superati da ADR 014 (fetta 8g)

## Contesto

Con la fetta 8e "Quando?" mostrava un giorno alla volta: per vedere il giorno dopo si toccava la striscia e le colonne cambiavano contenuto. Al telefono il gesto naturale è scorrere di lato. Andavano decisi:
- come disporre giorni e barbieri in una fila sola senza disegnare decine di colonne;
- quale giorno è "selezionato" mentre la fila scorre, e quando aggiornare striscia, URL e screen reader;
- come aprire la pagina già sul giorno giusto (`?giorno=`, "Indietro", cronologia) senza un salto visibile;
- quante richieste fare per i giorni vicini.

## Decisione

**Fila.** Per ogni giorno non chiuso della striscia (i "senza posti" compresi) le colonne dei barbieri nell'ordine di ADR 012, poi il giorno dopo. Le colonne sono larghe un quarto della larghezza utile (4 visibili a 390 px), qualunque sia il numero di barbieri. Fra due giorni uno spazio più largo con una linea sottile (`--day-gap`, `--day-divider`). Scorrimento nativo con `scroll-snap-type: x proximity`, `scroll-snap-align: start` su ogni colonna, nessuno `scroll-snap-stop`, `scroll-padding-left` di 16 px; la fila sborda fino ai bordi dello schermo. Ogni colonna scorre in verticale da sola sugli schermi alti (`overscroll-behavior: contain`, `overflow-x: hidden`); la fila ha `overscroll-behavior-x: contain`. Niente librerie di gesti: il blocco dell'asse lo fa il browser.

**Geometria pura** (`src/lib/booking/when-row.ts`): `rowDays`, `rowLayout`, `firstColumnOffset`, `dayAtScroll`, `renderWindow`, `initialWindow`, `rescaleScroll`. Le posizioni partono dal bordo dopo lo scroll-padding, così il margine di 16 px non conta mai come zona visibile.

**Giorno selezionato** = giorno della colonna più a sinistra visibile anche solo in parte (`dayAtScroll`, ricerca binaria). Al posto di IntersectionObserver (le colonne compaiono e spariscono, i segnaposto non hanno colonne vere) si legge solo `scrollLeft`, una volta per frame (`requestAnimationFrame`); le misure (larghezza delle colonne, gap, spazio fra i giorni) si prendono dal DOM all'apertura e a ogni ridimensionamento (`ResizeObserver`), quando `rescaleScroll` mantiene la stessa colonna a sinistra.
- La striscia segue il giorno a ogni frame (scorrendo solo la propria lista, `inline: nearest`, senza muovere la pagina né il focus).
- URL (`history.replaceState`) e annuncio `aria-live` solo a fila ferma: `scrollend`, oppure, dove manca (Safari), 150 ms senza eventi di scorrimento. Safari dà errore oltre 100 `replaceState` in 30 s e lo screen reader non deve annunciare ogni giorno attraversato. Next, dopo ogni `replaceState` della pagina, ne fa uno suo (stato `__NA`) per riallineare il router: per ogni giorno di arrivo le chiamate sono quindi due.
- Scorrimento comandato (striscia, "prossimo: …", pulsanti e frecce su desktop): la prima colonna del giorno va al bordo, morbido o istantaneo con `prefers-reduced-motion`; fino all'arrivo il giorno resta bloccato su quello di destinazione, e il blocco si toglie subito se l'utente tocca, usa la rotella o preme un tasto (`pointerdown`, `wheel`, `keydown`). Le colonne del giorno di arrivo tornano in cima. Se la fila finisce prima che l'ultimo giorno arrivi al bordo, il giorno scelto resta selezionato.

**Apertura sul giorno.** Il server valida `?giorno=` (formato, appartenenza al periodo, giorno non chiuso: `initialDay` di ADR 012) e lo scrive in `data-initial-day`; disegna la finestra attorno a quel giorno (`initialWindow`), così la colonna di destinazione esiste già nell'HTML. Uno script inline statico subito dopo la fila legge l'attributo e i `data-row-day` e imposta `scrollLeft` prima del primo disegno: nessun valore dell'URL è scritto nello script. Lo script esiste solo nell'HTML del server (sul client React non esegue gli script e lo segnala); nei rendering sul client (ritorno con la cronologia) la posizione la imposta un `useLayoutEffect`. Se un giorno si aggiunge una Content Security Policy, lo script avrà bisogno di un nonce.

**Disegno e dati.** Si disegnano solo i giorni che toccano la zona visibile allargata di uno schermo per lato (`renderWindow`); gli altri sono segnaposto `aria-hidden` con colonne vuote della stessa larghezza (punti di aggancio compresi), così la posizione non salta. I dati restano quelli di ADR 012 (`fetchWhenDay`, un giorno per richiesta, nessuna regola nuova):
- `dayCacheReducer` (`when-state.ts`): una voce per giorno (in caricamento, caricato, errore) con un id per richiesta; una risposta vecchia dello stesso giorno non sovrascrive la più recente e l'errore resta su quel giorno, che si riprova quando torna selezionato.
- `nextRequests` (`when-queue.ts`): la coda sono il giorno selezionato e i giorni visibili ±1, in ordine di vicinanza; niente doppioni, al massimo 3 richieste insieme (la pagina ne usa 1: Next esegue le server action una alla volta, quindi più richieste insieme restano solo in fila e farebbero aspettare la conferma del riepilogo), e un giorno uscito dalla zona prima di partire non parte più. Un giorno in errore si riprova quando torna selezionato (azione `retry` della cache), sempre attraverso la coda.
- Il giorno selezionato si chiede subito; i vicini solo dopo 600 ms a fila ferma. Le server action di Next partono una alla volta: richieste lanciate mentre si scorre o subito prima di toccare un orario facevano aspettare la conferma del riepilogo (visto negli e2e sotto carico).
- Le colonne in caricamento hanno la stessa testata e poche righe leggere; nessun `loading.tsx` né Suspense.

**Accessibilità.** La fila è una regione con etichetta, focusabile; ogni colonna un gruppo "Orari di <nome>, <giorno>" (decine di regioni sarebbero rumore per lo screen reader). La data in testata è solo visiva (è nel nome del gruppo). Su desktop (≥ 1024 px) pulsanti "Giorno precedente/successivo" fuori dalla fila e frecce ←/→ con il focus nella fila; nella striscia le frecce restano quelle della fetta 8e.

## Conseguenze

- Il tocco sulla striscia non cambia più il contenuto delle colonne: porta la fila sul giorno. "Primo libero" segue il giorno selezionato.
- Il reducer delle risposte in ritardo della fetta 8e (`whenReducer`) diventa la cache per giorno.
- Con 4 barbieri a 390 px, il primo orario parte sotto i 400 px; il sottotitolo dell'intestazione compatta si tronca su una riga.
- Da provare a mano su iPhone: blocco dell'asse fra fila e colonne, assenza di `scrollend` (ripiego a 150 ms), apertura con `?giorno=` senza salto.
