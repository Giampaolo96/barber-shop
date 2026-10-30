# ADR 014 – "Quando?": orari di tutti i giorni, rotazione e scorrimento

Data: 2026-10-25 · Stato: accettata · Fetta 8g · Aggiorna ADR 013 e SPEC §5.2

## Contesto

La prova su iPhone in produzione della fila continua (fetta 8f, ADR 013) ha mostrato quattro problemi:
1. il riquadro "Primo libero" sopra le colonne occupava spazio e ripeteva quello che le colonne dicono già;
2. scorrendo si aspettava ogni giorno: ogni giorno era una server action separata, Next le esegue una alla volta e i giorni vicini partivano solo dopo 600 ms a fila ferma;
3. due scorrimenti annidati (la fila in orizzontale, ogni colonna in verticale): finché la fila è in inerzia o si sta agganciando, iOS dà il nuovo tocco alla fila, e passare al verticale richiede di staccare il dito e aspettare;
4. ruotando il telefono si finiva su un altro giorno (dal 14 novembre al 5, da metà fra il 5 e il 6 al 12).

## Decisione

### 1. Via "Primo libero"
Tolti il riquadro, il suo stato vuoto, i testi (`firstFree`, `noSlots`), `firstFree` del motore, `firstFreeAmong`, l'utility `emphasis` e i parametri `barberId`/`recentBarberId` di `fetchWhenDay`. Il barbiere dell'ultimo appuntamento resta per l'ordine delle colonne. L'annuncio aria-live a fila ferma dice "<giorno>, nessun orario libero" (`dayAnnounceEmpty`) quando il giorno non ha orari. A 390×844 il primo orario passa da circa 380 a 320 px dall'alto.

### 2. Orari di tutti i giorni con la pagina
`getWhenOverview` leggeva già l'intero periodo prenotabile con una sola chiamata ad `availability_inputs` (lavoro, assenze, chiusure e occupati in un'unica RPC) e passava su ogni giorno per lo stato della striscia, fermandosi al primo orario. Ora completa il calcolo con `slotsByDay` (motore puro, `src/lib/availability/slots.ts`): orari di ogni barbiere in ogni giorno da una sola preparazione dell'input, con il prossimo orario dei barbieri pieni ricavato all'indietro dagli stessi dati. La pagina riceve `whenDays` (i giorni non chiusi) e il client li mette tutti nella cache per giorno (`dayCacheReducer`). Tolti la coda (`when-queue.ts`) e il precaricamento ritardato.

Misura (cliente demo, seed: 3 barbieri, 30 giorni, granularità 15'; mediane su 15–20 richieste dopo una di riscaldamento, Supabase locale):

| | Prima | Dopo |
|---|---|---|
| Build di produzione, documento | 86 ms; 121 KB, 9,2 KB gzip, 6,4 KB brotli | 96 ms; 352 KB, 15 KB gzip, 8,1 KB brotli |
| Build di produzione, navigazione RSC | 64 ms; 15 KB, 3,2 KB gzip | 80 ms; 69 KB, 5,7 KB gzip |
| Dev, documento | 276 ms; 128 KB, 11 KB gzip | 242 ms; 360 KB, 17 KB gzip |
| Dev, navigazione RSC | 158 ms; 20 KB, 4,6 KB gzip | 126 ms; 74 KB, 7,1 KB gzip |

Sotto le soglie decise (+150 ms sul server, 30 KB compressi): tutti i giorni arrivano con la pagina, senza la strada "7 giorni più una richiesta". Il documento cresce soprattutto perché i giorni disegnati all'apertura (fino a 7) hanno già i loro orari, non più le righe di caricamento. Con molti più barbieri, granularità di 5' o un periodo più lungo il peso cresce in proporzione: in quel caso si torna alla strada dei primi 7 giorni più una richiesta GET subito dopo l'idratazione.

**Freschezza.** Quando la pagina torna visibile (`visibilitychange`) con orari più vecchi di 2 minuti parte una sola richiesta per tutti i giorni della fila: `GET /prenota/quando/orari?servizio=&da=&a=` (route handler dinamico, `requireRole(["customer"])` come prima istruzione, profilo completo, cliente bloccato → 403, Zod, periodo dentro quello prenotabile, `Cache-Control: private, no-store`, solo orari e id dei barbieri). È un GET e non una server action perché Next esegue le server action una alla volta: una ricarica in corso farebbe aspettare la conferma del riepilogo. Gli orari mostrati restano finché non arriva la risposta (`loadedMany`: vince una richiesta singola più recente in corso); un errore li lascia com'erano. Alla conferma vale comunque il vincolo del database. Anche il nuovo tentativo su un giorno usa questa GET con `da` = `a` (audit del 30 ottobre, punto 6), quindi con gli stessi controlli. Un giorno chiuso nel frattempo non è nella risposta: resta senza orari e senza il link al prossimo orario.

### 3. Rotazione
La colonna più a sinistra si ricorda come identità, `RowAnchor = { day, barberIndex, fraction }` (`captureAnchor`/`restoreAnchor`, funzioni pure in `when-row.ts`), catturata solo a fila ferma e mai durante un ridimensionamento. Il ridimensionamento inizia con l'evento `resize` della finestra, con il ResizeObserver, o con uno scroll quando la larghezza della fila non è più quella misurata. Durante il ridimensionamento:
- gli eventi di scroll e `scrollend` non cambiano giorno, URL, striscia né ancora;
- a ogni misura la fila si riallinea all'ancora;
- a layout stabile (150 ms senza ridimensionamenti, poi due frame) arriva l'ultimo riallineamento e torna la posizione verticale: lo `scrollTop` di ogni colonna sugli schermi alti (il cambio di disposizione lo azzera, quindi si ricorda per colonna) e `window.scrollY` sotto i 600 px.

**Causa trovata in WebKit.** WebKit riscala da solo `scrollLeft` quando cambia il layout e manda `scroll` e `scrollend` *prima* del ResizeObserver. Con la fetta 8f, `scrollend` faceva scegliere il giorno con le misure vecchie: in Playwright WebKit, aperto sul 4 novembre e ruotato, la fila finiva sull'11–12 e l'URL cambiava. Con l'inizio del ridimensionamento anticipato all'evento `resize` il giorno resta il 4 sia in Chromium sia in WebKit (e2e `booking-when-rotation.spec.ts`, progetto `mobile-webkit`).

### 4. Un solo scorrimento per entrambe le direzioni: scartato, resta lo scorrimento attuale
Verificato nei sorgenti di WebKit (main del 2026-10-25):
- `Source/WebKit/UIProcess/ios/WKScrollView.mm`: lo scorrimento della pagina imposta `self.directionalLockEnabled = YES`.
- `Source/WebKit/UIProcess/RemoteLayerTree/ios/RemoteLayerTreeViews.mm`, `WKChildScrollView`: è lo `UIScrollView` creato per ogni elemento `overflow: auto`. Non imposta `directionalLockEnabled`, e il default di UIKit è `NO`. Nel repository la proprietà compare solo in `WKScrollView.mm`.
- `WKBaseScrollView` (`_axisLockingPanGestureRecognizer`, `axesToPreventScrollingForPanGesture…` in `ScrollingTreeScrollingNodeDelegateIOS.mm`) azzera un asse solo quando `touch-action` lo esclude; con `touch-action: auto` non blocca nulla.

Conseguenza: in un contenitore `overflow: auto` che scorre su due assi, iOS non blocca la direzione e un gesto quasi orizzontale si porta dietro anche il verticale. La pagina stessa invece la blocca, ma farla scorrere in orizzontale allarga la vista su alcuni browser (Chromium mobile in Playwright passa a un layout di 1560 px).

Le varianti sono in pagine di prova non committate (`prototypes/scorrimento-8g/`):
1. attuale;
2. A, un contenitore su due assi;
3. B, la pagina su due assi;
4. C, pagina verticale e fila orizzontale, con le testate fuori dalla fila che seguono con `animation-timeline` su una `scroll-timeline` della fila;
5. D, come C con le testate dentro la fila.

**Decisione (utente, 2026-10-25, dopo la prova delle 5 varianti su iPhone):** resta lo scorrimento attuale, la fila orizzontale con ogni colonna che scorre da sola (SPEC §5.2, "Scorrimento"). È risultata la più naturale nelle prove su iPhone. Nessuna implementazione delle varianti A–D; i test sospesi per lo scorrimento unico non si scrivono e quelli della fetta 8f sullo scorrimento delle colonne restano validi.

## Conseguenze

- Lo scorrimento resta quello della fetta 8f; il problema del passaggio dall'orizzontale al verticale durante l'inerzia della fila resta un comportamento noto di iOS (due scorrimenti annidati), giudicato accettabile rispetto alle alternative provate.

- Scorrendo su qualunque giorno non parte nessuna richiesta e non compare nessuno stato di caricamento (e2e `booking-when-loading.spec.ts`).
- La pagina pesa circa 6 KB compressi in più e il server lavora circa 10 ms in più (build di produzione locale).
- `rescaleScroll` (fetta 8f) resta con i suoi test ma la pagina usa l'ancora.
- `booking.spec.ts`: `lastSlot` cerca solo nel giorno selezionato. Prima i giorni vicini non avevano ancora gli orari e il test funzionava per caso (modifica approvata dall'utente).
- Da provare su iPhone: rotazione (verticale → orizzontale → verticale su un giorno lontano e a metà fra due giorni), ricarica tornando all'app dopo più di 2 minuti, nessuna attesa scorrendo fino all'ultimo giorno.
