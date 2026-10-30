# Specifica funzionale – App prenotazioni Barber Shop

Versione 0.1 – bozza MVP. I valori indicati come "default" sono configurabili dall'admin e vanno confermati con il barber shop.

---

## 1. Obiettivo

Permettere ai clienti di prenotare un servizio in autonomia dal telefono e al personale del negozio di gestire calendario, servizi, orari e clienti da un pannello web.

- **Clienti** → PWA ottimizzata per mobile, installabile sulla home del telefono.
- **Admin / barbieri** → stessa applicazione, area riservata `/admin` ottimizzata per desktop e tablet.

Un solo negozio (single-tenant). Il multi-negozio è fuori scope ma il modello dati non deve impedirlo in futuro.

---

## 2. Ruoli

| Ruolo | Chi è | Cosa può fare |
|---|---|---|
| `customer` | Cliente registrato | Vede servizi e disponibilità, prenota, vede/cancella le proprie prenotazioni, gestisce il proprio profilo |
| `barber` | Dipendente | Vede il proprio calendario, crea prenotazioni manuali per sé, sposta l'orario delle proprie prenotazioni confermate non ancora iniziate (§6.3), segna completata / no-show / cancellata (dal cliente o dal negozio), gestisce le proprie assenze (senza approvazione dell'admin) |
| `admin` | Titolare | Tutto: servizi, barbieri, orari, chiusure, tutte le prenotazioni, clienti, impostazioni, statistiche |

Un utente ha un solo ruolo. Un admin può essere anche barbiere: lo è quando esiste una riga `barbers` collegata al suo profilo (`barbers.profile_id`), senza flag dedicato.

---

## 3. Entità e regole del dominio

### 3.1 Impostazioni negozio (`shop_settings`, riga singola)
- Nome, indirizzo, telefono, logo, timezone (default `Europe/Rome`).
- `slot_granularity_min` – passo degli orari proposti (default **15**; ammessi solo 5, 10, 15, 20, 30, 60).
- `min_advance_min` – anticipo minimo per prenotare (default **60**, massimo 7 giorni).
- `max_horizon_days` – quanto avanti si può prenotare (default **30**, da 1 a 365).
- `cancel_limit_min` – il cliente può cancellare fino a X minuti prima (default **120**, massimo 7 giorni).
- `buffer_min` – pausa automatica dopo ogni appuntamento (default **0**, massimo 60).
- `no_show_block_threshold` – dopo N no-show il cliente viene bloccato dalla prenotazione online (default **3**, 0 = disattivato, massimo 10). Si contano le no-show dall'ultimo azzeramento dell'admin (§6.7).
- `privacy_policy_version` – versione corrente dell'informativa privacy: il consenso di un cliente vale solo per questa versione.

### 3.2 Servizi (`services`)
- Nome, descrizione, durata in minuti, prezzo in **centesimi** (intero), attivo/disattivo, ordine di visualizzazione.
- Esempi: Taglio (30'), Barba (20'), Taglio + Barba (45'), Taglio bambino (20').
- Un servizio disattivato non è più prenotabile ma resta sulle prenotazioni storiche.

### 3.3 Barbieri (`barbers`)
- Nome visualizzato, foto, bio breve, attivo/disattivo, collegamento opzionale a un account staff.
- La foto (ritratto) la carica e la rimuove solo l'admin dalla scheda del barbiere: viene salvata in Supabase Storage come WebP quadrato 512×512 e mostrata con il testo alternativo "Ritratto di <nome>"; senza foto compare l'iniziale. Eliminando il barbiere si cancella anche la foto; disattivandolo resta (fetta 8d, ADR 011).
- Relazione molti-a-molti con i servizi (`barber_services`): non tutti fanno tutto.

### 3.4 Orari di lavoro (`working_hours`)
- Per barbiere e giorno della settimana, **una o più fasce** (es. 09:00–13:00 e 15:00–19:30).
- Orari espressi in ora locale del negozio.

### 3.5 Assenze e chiusure
- `time_off`: assenza di un barbiere (ferie, malattia, permesso) con inizio/fine (anche parziale nella giornata).
- `shop_closures`: chiusura dell'intero negozio (festivi, ferie collettive).

### 3.6 Prenotazioni (`bookings`)
- Cliente (o nominativo + telefono per prenotazioni manuali di clienti non registrati), barbiere, servizio, `starts_at`, `ends_at` (timestamptz), prezzo e durata **copiati** dal servizio al momento della prenotazione, nota del cliente (`notes`, visibile al cliente).
- Prezzo e durata copiati non seguono le modifiche successive al servizio. Solo l'admin può modificarli sulla prenotazione (sconto, appuntamento più lungo); cambiando servizio vengono ricopiati. L'orario di fine è sempre ricalcolato dal database.
- Note interne dello staff: separate dalla nota del cliente (`booking_staff_notes`), mai visibili al cliente; il barbiere le gestisce sulle proprie prenotazioni, l'admin su tutte. Seguono la prenotazione se viene riassegnata a un altro barbiere.
- Solo l'admin può eliminare una prenotazione; barbiere e cliente la cancellano con un cambio di stato.
- `source`: `online` | `manual` (creata dallo staff).
- Stati:

```
confirmed ──► completed
    │
    ├──► cancelled_by_customer
    ├──► cancelled_by_shop
    └──► no_show
```

- MVP: un servizio per prenotazione, nessuna conferma manuale (la prenotazione online è subito `confirmed`).

### 3.7 Regole invarianti (da garantire nel database, non solo nell'UI)
1. Due prenotazioni attive (`confirmed`) dello stesso barbiere **non possono sovrapporsi**, buffer incluso → vincolo di esclusione Postgres su `tstzrange` (estensione `btree_gist`).
2. Una prenotazione online deve cadere interamente dentro una fascia di lavoro, fuori da assenze e chiusure, rispettando anticipo minimo e orizzonte massimo.
3. Il barbiere scelto deve essere abilitato al servizio.
4. Il cliente vede solo le proprie prenotazioni; non deve mai poter dedurre dati di altri clienti.
5. Le prenotazioni manuali dello staff possono derogare alle regole 2 (es. fuori orario), mai alla 1 né alla 6. La deroga richiede una conferma esplicita degli avvisi (fuori fascia, assenza, chiusura, orario passato), ricalcolati dal server a ogni invio (ADR 006).
6. Un cliente non può avere due prenotazioni `confirmed` sovrapposte (su `[inizio, fine)`, senza buffer), nemmeno con barbieri diversi → vincolo di esclusione su `customer_id`, valido per tutti i percorsi (online, manuali, spostamenti, ripristino); le prenotazioni intestate a un ospite senza account sono escluse.

---

## 4. Calcolo della disponibilità

Input: servizio, data, barbiere (oppure "qualsiasi").

Per ogni barbiere candidato (abilitato al servizio e attivo):
1. Prendi le fasce di lavoro del giorno della settimana, convertite in timestamp reali nella timezone del negozio (attenzione ai cambi di ora legale).
2. Sottrai chiusure del negozio e assenze del barbiere.
3. Sottrai le prenotazioni `confirmed` esistenti, ciascuna fino al proprio `blocked_until` (buffer copiato alla creazione).
4. Negli intervalli liberi rimasti genera gli orari di inizio sulla griglia dell'orologio locale (multipli di `slot_granularity_min` dalla mezzanotte), tenendo solo quelli per cui `inizio + durata servizio` sta dentro l'intervallo e `inizio + durata + buffer_min` non tocca la prenotazione successiva (nessuna pausa richiesta prima di fine fascia, assenze o chiusure).
5. Scarta gli orari prima di `now + min_advance_min` (bordo incluso) e quelli che iniziano dopo la fine del giorno locale di oggi + `max_horizon_days`.

Con "qualsiasi barbiere": unione degli orari; alla conferma viene assegnato, tra i barbieri liberi in quello slot, quello con meno prenotazioni non cancellate quel giorno; a parità decide un criterio deterministico che ruota con la data. Dettagli in `docs/adr/004-motore-disponibilita.md`.

Il calcolo avviene lato server (funzione Postgres `security definer` o server action) e restituisce **solo orari**, mai dati di altre prenotazioni. L'inserimento finale è comunque protetto dal vincolo di esclusione: se due clienti prendono lo stesso slot in contemporanea, il secondo riceve un errore gestito ("Orario appena occupato, scegline un altro").

---

## 5. Funzionalità – lato cliente (mobile / PWA)

1. **Home**: info negozio, pulsante "Prenota", prossima prenotazione in evidenza come "biglietto" con il conto alla rovescia in giorni di calendario nella timezone del negozio ("Oggi", "Domani", "Tra N giorni", fetta 8b). Stato di apertura del giorno ("Aperto fino alle…", "Apre alle…", "Oggi chiuso") e orari della settimana: sono l'unione delle fasce dei barbieri attivi, meno le chiusure di oggi, senza dati sui singoli barbieri (`shop_opening_hours`, `shop_closures_today`, fetta 8a).
2. **Flusso di prenotazione** (3 schermate, fetta 8e: servizio → "Quando?" → conferma):
   1. scelta servizio (nome, durata, prezzo);
   2. **"Quando?"** (`/prenota/quando?servizio=<id>&giorno=<YYYY-MM-DD>[&barbiere=<id>]`): gli orari liberi di tutti i barbieri attivi che fanno il servizio, in una **fila continua di colonne** (giorno × barbiere, fetta 8f, ADR 013) pensata per il telefono (riferimento 390 px; su desktop lo stesso layout, centrato e più largo). Sopra le colonne la parte fissa è compatta (titolo piccolo con il servizio accanto, striscia bassa), così a 390×844 il primo orario parte a circa 320 px e si vedono almeno 9 orari per colonna (fetta 8g: niente "Primo libero").
      - **Striscia dei giorni** in alto, a scorrimento orizzontale e fissa (sticky) quando scorre la pagina intera (schermi bassi, vedi sotto), da oggi fino al limite di `max_horizon_days` (§4.5). Un giorno è **chiuso** (disattivato) quando nessun barbiere attivo che fa il servizio ha ore di lavoro quel giorno al netto di chiusure e assenze; se lavorano ma non ci sono orari prenotabili è **senza posti** (attenuato con il bordo tratteggiato, ma selezionabile). I dati di disponibilità partono da adesso: oggi, dopo l'ultima fascia di lavoro, il giorno risulta quindi **chiuso** e non "senza posti" (decisione fetta 8e, ADR 012). Il giorno selezionato è nell'URL; senza giorno valido (o con un giorno chiuso o fuori periodo) si parte dal primo giorno con almeno un orario libero. Navigabile da tastiera, focus visibile. La striscia segue il giorno selezionato della fila (la sua casella entra nella vista della striscia senza muovere la pagina né il focus); il tocco su un giorno porta la fila sulla prima colonna di quel giorno.
      - **Fila continua** (fetta 8f): per ogni giorno della fila le colonne dei barbieri nell'ordine sotto, poi le colonne del giorno dopo, e così via. Giorni della fila: quelli non chiusi della striscia, dal primo giorno non chiuso all'ultimo entro `max_horizon_days`; i giorni chiusi non ci sono, i "senza posti" sì. Fra l'ultima colonna di un giorno e la prima del successivo uno spazio più largo con una linea sottile. Scorrimento nativo con aggancio morbido alle colonne (`scroll-snap` x non obbligatorio, `start`, senza `scroll-snap-stop`): ci si può fermare a metà fra due giorni e scorrere di molte colonne alla volta; limiti: la prima colonna del primo giorno e l'ultima colonna dell'ultimo giorno.
      - **Giorno selezionato** = giorno della colonna più a sinistra visibile anche solo in parte (esclusi i 16 px di margine): cambia solo quando tutte le colonne del giorno prima sono uscite a sinistra e torna indietro appena una rientra. La striscia lo segue durante lo scorrimento; URL (`replaceState`) e annuncio per lo screen reader solo a fila ferma (`scrollend`, o 150 ms senza scorrimento): "Orari di <giorno>", oppure "<giorno>, nessun orario libero" se il giorno non ha orari. Tocco sulla striscia, link "prossimo: …", apertura con `?giorno=`, ritorno con "Indietro" o con la cronologia: la prima colonna del giorno va al bordo sinistro (morbido, istantaneo con il movimento ridotto) e le colonne di quel giorno partono dall'inizio. Su desktop (≥ 1024 px) anche i pulsanti "Giorno precedente/successivo" ai lati della fila e le frecce ←/→ con il focus nella fila. Ridimensionando (rotazione, finestra, testo ingrandito) resta la stessa colonna a sinistra, con la stessa frazione già uscita, e lo stesso giorno; giorno selezionato, URL e striscia non cambiano per effetto del ridimensionamento, e ogni colonna (sotto i 600 px la pagina) resta agli stessi orari (fetta 8g, ADR 014).
      - **Una colonna per barbiere e giorno**, di larghezza uguale: 4 visibili nella larghezza utile, qualunque sia il numero di barbieri. In testa, fissa e alta uguale per tutte: la data piccola ("mer 21"), ritratto piccolo (iniziale come ripiego, §3.3) e nome, troncato se serve; sul preferito l'etichetta "Il tuo" sull'angolo del ritratto. La bio non si mostra in questa vista. Sotto, gli orari liberi uno per riga, pulsanti larghi quanto la colonna e alti almeno 44 px; tra mattina (prima delle 13:00 locali) e pomeriggio un divisore sottile "Pomeriggio" (abbreviato se la colonna è stretta), solo quando ci sono orari di entrambi. Ogni orario ha l'etichetta completa ("10:30 con Giovanni"); ogni colonna è un gruppo "Orari di <nome>, <giorno>" e la fila una regione con etichetta, focusabile.
      - **Scorrimento**: sugli schermi alti almeno 600 px la pagina occupa lo schermo (`100dvh`) e ogni colonna scorre da sola (`overscroll-behavior: contain`), senza muovere le altre né la pagina; una sfumatura in fondo segnala altri orari sotto. Sotto i 600 px di altezza (es. telefono in orizzontale) le colonne non scorrono da sole e scorre la pagina intera. Nessun overflow orizzontale della pagina: di lato scorre solo la fila.
      - **Barbiere senza posti** quel giorno: nella sua colonna "Nessun orario" e il link al suo prossimo orario libero nei giorni successivi ("prossimo: mar 20, 9:30", l'ora solo se ci sta; il nome accessibile è sempre completo); se non ne ha nel periodo prenotabile, solo "Nessun orario".
      - **Ordine dei barbieri**: prima il barbiere preferito arrivato dall'URL (prima colonna, con "Il tuo"), poi, per un cliente con appuntamenti passati, il barbiere dell'ultimo appuntamento già iniziato (escluse le cancellate; ignorato se non è attivo o non fa il servizio), poi gli altri per nome.
      - Gli orari vengono dal motore di §4 senza regole nuove e contengono solo orari e id dei barbieri. Gli orari di **tutti i giorni della fila** arrivano con la pagina, calcolati sul server da una sola lettura del periodo prenotabile (fetta 8g, ADR 014): scorrendo non parte nessuna richiesta e non compare nessuno stato di caricamento. Si disegnano solo i giorni vicini alla zona visibile (gli altri restano segnaposto della stessa larghezza). Quando la pagina torna visibile con orari più vecchi di 2 minuti, una sola richiesta (GET `/prenota/quando/orari`, non una server action) li ricarica in background senza farli sparire; un giorno non caricato mostra l'errore solo nelle sue colonne e si riprova quando torna selezionato, con la stessa GET limitata a quel giorno. Il controllo finale resta quello della creazione: se l'orario è stato preso nel frattempo la conferma mostra l'errore e riporta a "Quando?" sullo stesso giorno.
      - I vecchi URL `/prenota/barbiere` e `/prenota/orario` fanno redirect a "Quando?" mantenendo servizio, barbiere (non "qualsiasi") e giorno.
   3. riepilogo + note opzionali + conferma. Dopo la conferma si apre la schermata dedicata `/prenotazioni/<id>/confermata` (solo il cliente proprietario, altrimenti 404; una prenotazione propria cancellata o passata rimanda a "Le mie prenotazioni"), con "Aggiungi al calendario": file iCalendar `/prenotazioni/<id>/calendario.ics` solo per le proprie prenotazioni confermate e future, orari in UTC, titolo "<servizio> – <negozio>", luogo dall'indirizzo, UID stabile indipendente dal dominio, nessun altro dato personale (fetta 8b).
3. **Le mie prenotazioni**: future e passate; cancellazione consentita fino a `cancel_limit_min` prima (bordo incluso), poi pulsante "Chiama il negozio". Il cliente bloccato (manualmente o per no-show) vede l'invito a chiamare il negozio già all'inizio del flusso.
4. **Profilo**: nome, telefono, email, consensi, eliminazione account.
5. **Registrazione/login**: email con magic link e codice a 6 cifre (fetta 8, ADR 009): il codice si digita nella pagina in cui si è chiesto l'accesso, quindi apre la sessione anche nell'app installata; 5 errori per codice e al massimo 10 all'ora per email, codice e link validi 15 minuti; il login Google è rimandato (vedi domande aperte). Il telefono è obbligatorio in profilo per essere contattabili: al primo accesso il cliente completa il profilo (nome, telefono salvato in formato E.164, consensi), necessario per le pagine private e per prenotare ma non per le pagine pubbliche. Lo staff entra con email e password da `/admin/login`, senza auto-registrazione.
6. **Installazione PWA**: banner in home, solo sui telefoni (puntatore principale touch e viewport da telefono, mai sul computer), che spiega come aggiungere l'app alla schermata Home (istruzioni specifiche per iOS, pulsante "Installa" dove il browser lo permette); "Non ora" lo chiude per sempre su quel dispositivo e resta la voce "Installa l'app" nel profilo, presente su ogni dispositivo (sul computer "Installa l'app sul computer", senza riferimenti a telefono e schermata Home). Service worker minimo: in cache solo file statici, icone e la pagina offline (ADR 009).

## 6. Funzionalità – lato admin (web)

1. **Calendario giornaliero** con una colonna per barbiere, vista settimanale, navigazione per data; click su slot vuoto → nuova prenotazione manuale; click su prenotazione → dettaglio e cambio stato. Il barbiere vede solo la propria colonna; la vista settimanale mostra un barbiere alla volta (per l'admin la propria scheda se è anche barbiere, altrimenti il primo barbiere attivo per nome). La griglia copre fasce di lavoro e prenotazioni del giorno; le cancellate sono nascoste, con un conteggio e un link per mostrarle. La vista settimanale è una griglia come quella del giorno (fetta 8c): una colonna per giorno da lunedì a domenica con le stesse righe (`slot_granularity_min`), fuori orario, assenze e chiusure come sfondo, giorni di chiusura totale attenuati, linea dell'ora attuale nella colonna di oggi; click su slot vuoto e trascinamento si comportano come nella vista giorno, con gli stessi permessi. Non si disegnano i giorni di chiusura settimanale fissa: quelli in cui il negozio non ha orari di apertura (gli stessi orari della home, `shop_opening_hours`), salvo che in quella data il barbiere abbia prenotazioni da mostrare (non cancellate, o cancellate con "mostra cancellate"). Le chiusure straordinarie non nascondono il giorno. La settimana resta da lunedì a domenica per URL e navigazione; le colonne visibili si allargano nello spazio libero e su desktop stanno tutte senza scorrimento orizzontale; per un appuntamento in un giorno nascosto si usa la vista giorno (ADR 008). Su telefono la griglia scorre in orizzontale dentro il proprio contenitore, con la colonna delle ore e le intestazioni dei giorni fisse, e all'apertura mostra oggi; se oggi è nascosto parte dalla prima colonna, senza linea dell'ora.
2. **Prenotazione manuale**: ricerca cliente esistente o inserimento rapido nome + telefono (E.164); nota interna dello staff facoltativa. Fuori fascia, in assenza, in chiusura o nel passato serve "Conferma comunque" (§3.7.5).
3. **Spostamento prenotazione** (cambio orario/barbiere, servizio, durata, prezzo; solo admin) con verifica sovrapposizioni. Cambiando servizio durata e prezzo si ricopiano dal nuovo servizio. Gli avvisi valgono solo se cambiano orario, barbiere o fine di una prenotazione `confirmed`. **Trascinamento nelle viste giorno e settimana** (ADR 008): si spostano solo le `confirmed` non ancora iniziate e solo verso un orario futuro (per gli orari passati l'admin usa la modifica), agganciandosi alle righe della griglia; nella vista giorno l'admin anche verso un'altra colonna (barbiere attivo), il barbiere solo le proprie e solo nell'orario; nella vista settimana verso un altro giorno o orario, sempre per lo stesso barbiere. Durata e prezzo non cambiano. Gli avvisi aprono un dialogo con "Conferma comunque"; dopo il salvataggio "Annulla spostamento" resta disponibile per 8 secondi. Il barbiere ha anche il modulo "Sposta orario" nel dettaglio.
4. **Servizi**: CRUD, ordinamento, attivazione.
5. **Barbieri**: CRUD, servizi abilitati, orari settimanali, assenze. Vista delle assenze (`/admin/assenze`): l'admin vede quelle di tutti i barbieri, prima le future, con filtro per barbiere (parte dalla propria scheda se è anche barbiere) e ne inserisce scegliendo il barbiere; il barbiere vede e gestisce solo le proprie.
6. **Chiusure negozio**.
7. **Clienti** (solo admin): elenco con ricerca per nome, telefono o email, storico prenotazioni, contatore no-show, blocco/sblocco. Il blocco manuale impedisce solo la prenotazione online (le prenotazioni già fissate restano). "Azzera no-show" toglie il blocco automatico: da quel momento contano solo le no-show di appuntamenti successivi all'azzeramento (ADR 007). Nella ricerca della prenotazione manuale i clienti bloccati hanno l'etichetta "Bloccato".
8. **Impostazioni**: i parametri della sezione 3.1.
9. **Statistiche base** (solo admin, ADR 010): prenotazioni e incasso stimato per giorno/settimana/mese, per barbiere e per servizio, tasso di no-show.
   - Ogni prenotazione conta nel giorno dell'appuntamento (`starts_at` nella timezone del negozio); settimane da lunedì; periodo scelto dall'admin (predefinito il mese corrente), al massimo 366 giorni.
   - Raggruppamento dell'andamento ("Mostra per"): se l'admin non lo sceglie dipende dall'ampiezza del periodo, fino a 62 giorni per giorno, fino a 120 per settimana, oltre per mese (quindi settimana e mese per giorno, ultimi 3 mesi per settimana, anno per mese). Una scelta esplicita (anche nell'URL) vale su qualunque periodo e resta passando da un periodo rapido all'altro; "Automatico" torna al predefinito.
   - **Prenotazioni**: stati `confirmed`, `completed` e `no_show`; le cancellate si contano a parte (dal cliente e dal negozio).
   - **Incasso stimato**: somma di `price_cents` delle `completed` e `confirmed`.
   - **Tasso di no-show**: `no_show` diviso le prenotazioni non cancellate già iniziate ("—" se nessuna).
   - **Da aggiornare**: prenotazioni già iniziate ancora `confirmed` ("Appuntamenti già passati non ancora segnati come completati o no-show"). Se sono più di zero il riquadro porta all'elenco del periodo (data, ora, barbiere, cliente, servizio), con il collegamento al dettaglio dove si cambia lo stato.
   - Testi con le parole del titolare (appuntamenti, cancellati, clienti non presentati), non termini tecnici.
   - Grafico a barre dell'andamento (prenotazioni o incasso), con la tabella sotto come versione accessibile.
   - Nelle tabelle per barbiere e per servizio compaiono anche quelli attivi senza prenotazioni nel periodo (a zero); quelli disattivati solo se hanno prenotazioni nel periodo.
   - Le prenotazioni demo (nota del cliente uguale a "Prenotazione demo", senza spazi, tab o a capo ai bordi e senza distinguere maiuscole e minuscole) contano normalmente; una casella facoltativa, spenta di base, le esclude.

## 7. Notifiche (MVP)

- Email al cliente: conferma prenotazione, cancellazione (da chiunque), promemoria **24 ore prima**.
- Email/indicatore in dashboard allo staff per nuove prenotazioni e cancellazioni online.
- Promemoria inviati da un job schedulato (Supabase cron / Edge Function) ogni 15 minuti, con flag per non inviare doppioni.

Rimandati: push notification PWA, SMS, WhatsApp.

## 8. Privacy e sicurezza

- Informativa privacy e consenso esplicito al trattamento in registrazione; consenso marketing separato e facoltativo.
- I consensi li dà solo l'interessato (nemmeno l'admin modifica quelli altrui) e data e ora le registra il database. Il consenso privacy si riferisce alla versione corrente dell'informativa e non si revoca dal profilo; il marketing si può revocare in ogni momento.
- Dati raccolti minimi: nome, email, telefono, storico prenotazioni.
- Eliminazione account da parte del cliente → anonimizzazione delle prenotazioni passate (restano per le statistiche senza dati personali).
- Row Level Security attiva su **tutte** le tabelle; nessuna chiave privilegiata nel codice client.
- Rate limiting sulla creazione prenotazioni per evitare abusi: nel database, per cliente, al massimo 3 prenotazioni online future e 10 creazioni nelle ultime 24 ore; per le pagine del flusso (che richiedono il login) una regola del firewall Vercel (ADR 005).

## 9. Requisiti non funzionali

- Mobile first per il cliente, usabile con una mano; tempi di caricamento rapidi su 4G.
- Lingua: italiano (struttura predisposta per i18n, nessuna stringa hardcoded sparsa).
- Date e orari salvati in UTC (`timestamptz`), mostrati in `Europe/Rome`.
- Accessibilità di base: contrasto, dimensione minima dei tap target, label sui campi.

## 10. Fuori scope per l'MVP

Pagamenti e caparre online, più servizi in una prenotazione, lista d'attesa, prenotazioni ricorrenti, programma fedeltà, recensioni, multi-negozio, app native sugli store, integrazione Google Calendar dei barbieri.

## 11. Piano di sviluppo (fette verticali)

| # | Fetta | Fatta quando… |
|---|---|---|
| 0 | Setup progetto, CI, Supabase locale, deploy di prova | Pagina vuota online, test che girano in CI |
| 1 | Schema DB + RLS + seed dati demo | Migrazioni applicate, test RLS verdi |
| 2 | Auth e ruoli | Cliente e admin entrano e vedono aree diverse |
| 3 | Admin: servizi, barbieri, orari, assenze, chiusure, impostazioni | CRUD completi |
| 4 | Motore disponibilità | Test unitari sui casi limite verdi (sez. 12) |
| 5 | Flusso prenotazione cliente + "Le mie prenotazioni" | Prenotazione e cancellazione end-to-end con Playwright |
| 6 | Calendario admin + prenotazioni manuali + cambi stato | Staff gestisce una giornata intera |
| 6b | Admin: clienti (§6.7: elenco, storico, no-show, blocco/sblocco) | L'admin trova un cliente, ne vede lo storico e lo blocca o sblocca |
| 6c | Spostamento con trascinamento sul calendario (§6.3, ADR 008) | Admin e barbiere spostano una prenotazione trascinandola, con avvisi e annullamento |
| 7 | Notifiche email e promemoria | Email ricevute in ambiente di test |
| 8a | Identità visiva: design system a token, tema "Mosca", restyling cliente e admin (`docs/DESIGN.md`) | Screenshot a 390 e 1280 px rivisti, test esistenti verdi senza cambiare le asserzioni |
| 8 | PWA (manifest, icone, installazione) + rifinitura UI | Installabile su iOS e Android |
| 8b | Rifinitura estetica (tema Mosca, `docs/DESIGN.md`): biglietto della prossima prenotazione, listino, ritratti dei barbieri, schermata di conferma con file `.ics`, movimento solo CSS, stati vuoti, ora attuale nel calendario admin | Screenshot a 390 e 1280 px (anche stati vuoti e movimento ridotto) rivisti, conferma e `.ics` solo per il proprietario |
| 8c | Vista settimana a griglia per singolo barbiere (§6.1, §6.3): una colonna per giorno (senza i giorni di chiusura fissa) × righe come la vista giorno, click su slot vuoto, trascinamento anche su un altro giorno, scorrimento orizzontale su telefono | Screenshot a 390 e 1280 px rivisti, e2e di creazione e spostamento verdi, vista giorno invariata |
| 8d | Ritratti dei barbieri (§3.3, ADR 011): caricamento e rimozione da Admin → Barbieri, bucket pubblico in lettura con scrittura solo admin, ricodifica in WebP 512×512, ripiego sull'iniziale | L'admin carica una foto (anche da iPhone) e il cliente la vede nella scelta del barbiere |
| 8e | Prenotazione da telefono (§5.2): servizio → "Quando?" → conferma, orari di tutti i barbieri per giorno, "Primo libero", redirect dei vecchi URL | e2e a 390 px verdi (flusso, "Primo libero", barbiere pieno, striscia sticky, redirect, nessun overflow), screenshot a 390 e 1280 px rivisti |
| 8f | "Quando?" a fila continua di giorni (§5.2, ADR 013) e caselle arrotondate nel tema neon | e2e a 390 px verdi (fila, giorno selezionato, striscia, "Indietro", giorno non valido), screenshot a 390 e 1280 px rivisti |
| 8g | "Quando?": rifiniture della fila continua (§5.2, ADR 014): via "Primo libero", orari di tutti i giorni con la pagina e ricarica in background, rotazione che conserva colonna e giorno; lo scorrimento resta quello attuale (varianti provate su iPhone). Chiusa con il punto 6 dell'audit: il nuovo tentativo dopo un errore usa la route GET (da = a) con i suoi controlli, compreso il cliente bloccato; tolti `availability-actions.ts`, `getWhenDay` e le funzioni non usate elencate nell'audit, con i relativi test; il test su DB scrive il barbiere atteso | e2e di caricamento e rotazione (anche WebKit) verdi, misure di tempo e peso nel report, screenshot a 390×844, 844×390 e 1280×800 rivisti, nuovo tentativo negato al cliente bloccato |
| 8h | Sicurezza dati, prima del go-live (audit, punti 2 e 3): privilegi staff solo con sessione da password, con `auth.jwt() -> 'amr' @> '[{"method":"password"}]'` in `is_admin`, `is_staff` e `current_barber_id` (dopo un recupero si rientra con la password; claim aggiornati nei test pgTAP); `availability_inputs` restituisce un solo `jsonb` | Una sessione staff senza password non ha privilegi nel database, il recupero password porta a un nuovo accesso con password, test di `availability_inputs` oltre le 1000 righe verde |
| 8i | Correzioni admin (audit, punti 5, 8 e 9): una modifica non annulla uno spostamento concorrente, la nota interna non si perde in silenzio, nessun barbiere doppio a un nuovo invio | Un test per ogni correzione |
| 9a | Statistiche (§6.9, ADR 010) | L'admin vede prenotazioni, incasso stimato e no-show del periodo, per barbiere e per servizio |
| 9b | Privacy e account prima del go-live: nuovo consenso quando cambia la versione dell'informativa (versione di nuovo modificabile), eliminazione dell'account cliente con anonimizzazione dello storico, modifica di nome e telefono e revoca del marketing da `/profilo` (audit, punto 4), staff con invito via email, recupero e cambio password ed eliminazione account, TOTP per gli admin | Pronto per il primo uso reale |

Pulizia a bassa priorità, senza una fetta dedicata (audit del 30 ottobre, punti 7 e 10): le tre copie della logica sugli intervalli e i piccoli doppioni. Report completo in `docs/audit/2026-10-30-ponytail.md`.

## 12. Casi limite da coprire con test

- Giorno del passaggio all'ora legale e a quella solare.
- Servizio che finirebbe dentro la pausa pranzo o oltre la chiusura.
- Assenza parziale a metà mattina.
- Due prenotazioni concorrenti sullo stesso slot.
- Buffer > 0 tra appuntamenti consecutivi.
- Barbiere non abilitato al servizio richiesto.
- Cancellazione esattamente al limite di `cancel_limit_min`.
- Cliente bloccato per no-show che prova a prenotare.
- Servizio disattivato con prenotazioni future già esistenti.

## 13. Domande aperte (da chiarire con il barber shop)

1. Quanti barbieri, e il cliente deve poter scegliere il barbiere?
2. Orari reali, giorni di chiusura e listino servizi con durate.
3. Login cliente: basta email/Google o serve il numero di telefono verificato via SMS (costo per SMS)?
4. ~~Le assenze inserite dai barbieri richiedono approvazione dell'admin?~~ Deciso: no, nessuna approvazione (fetta 1).
5. Le prenotazioni online vanno confermate a mano o sono automatiche?
6. Serve una caparra o il pagamento anticipato per ridurre i no-show?
7. Chi riceve le notifiche lato negozio e su quale canale?
8. Nome e dominio dell'app, logo e colori del negozio.
9. Verifica in due passaggi per l'account admin? Senza, chi controlla l'email del negozio può reimpostare la password.
