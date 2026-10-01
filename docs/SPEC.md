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
| `barber` | Dipendente | Vede il proprio calendario, crea prenotazioni manuali per sé, segna completata / no-show, gestisce le proprie assenze (soggette ad approvazione? → domanda aperta) |
| `admin` | Titolare | Tutto: servizi, barbieri, orari, chiusure, tutte le prenotazioni, clienti, impostazioni, statistiche |

Un utente ha un solo ruolo. Un admin può essere anche barbiere (flag `is_barber` sul profilo staff).

---

## 3. Entità e regole del dominio

### 3.1 Impostazioni negozio (`shop_settings`, riga singola)
- Nome, indirizzo, telefono, logo, timezone (default `Europe/Rome`).
- `slot_granularity_min` – passo degli orari proposti (default **15**).
- `min_advance_min` – anticipo minimo per prenotare (default **60**).
- `max_horizon_days` – quanto avanti si può prenotare (default **30**).
- `cancel_limit_min` – il cliente può cancellare fino a X minuti prima (default **120**).
- `buffer_min` – pausa automatica dopo ogni appuntamento (default **0**).
- `no_show_block_threshold` – dopo N no-show il cliente viene bloccato dalla prenotazione online (default **3**, 0 = disattivato).

### 3.2 Servizi (`services`)
- Nome, descrizione, durata in minuti, prezzo in **centesimi** (intero), attivo/disattivo, ordine di visualizzazione.
- Esempi: Taglio (30'), Barba (20'), Taglio + Barba (45'), Taglio bambino (20').
- Un servizio disattivato non è più prenotabile ma resta sulle prenotazioni storiche.

### 3.3 Barbieri (`barbers`)
- Nome visualizzato, foto, bio breve, attivo/disattivo, collegamento opzionale a un account staff.
- Relazione molti-a-molti con i servizi (`barber_services`): non tutti fanno tutto.

### 3.4 Orari di lavoro (`working_hours`)
- Per barbiere e giorno della settimana, **una o più fasce** (es. 09:00–13:00 e 15:00–19:30).
- Orari espressi in ora locale del negozio.

### 3.5 Assenze e chiusure
- `time_off`: assenza di un barbiere (ferie, malattia, permesso) con inizio/fine (anche parziale nella giornata).
- `shop_closures`: chiusura dell'intero negozio (festivi, ferie collettive).

### 3.6 Prenotazioni (`bookings`)
- Cliente (o nominativo + telefono per prenotazioni manuali di clienti non registrati), barbiere, servizio, `starts_at`, `ends_at` (timestamptz), prezzo e durata **copiati** dal servizio al momento della prenotazione, note.
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
5. Le prenotazioni manuali dello staff possono derogare alle regole 2 (es. fuori orario), mai alla 1.

---

## 4. Calcolo della disponibilità

Input: servizio, data, barbiere (oppure "qualsiasi").

Per ogni barbiere candidato (abilitato al servizio e attivo):
1. Prendi le fasce di lavoro del giorno della settimana, convertite in timestamp reali nella timezone del negozio (attenzione ai cambi di ora legale).
2. Sottrai chiusure del negozio e assenze del barbiere.
3. Sottrai le prenotazioni `confirmed` esistenti, ciascuna estesa di `buffer_min`.
4. Negli intervalli liberi rimasti genera gli orari di inizio con passo `slot_granularity_min`, tenendo solo quelli per cui `inizio + durata servizio + buffer` sta dentro l'intervallo.
5. Scarta gli orari prima di `now + min_advance_min` e oltre `max_horizon_days`.

Con "qualsiasi barbiere": unione degli orari; alla conferma viene assegnato il barbiere libero con meno prenotazioni quel giorno (bilanciamento semplice).

Il calcolo avviene lato server (funzione Postgres `security definer` o server action) e restituisce **solo orari**, mai dati di altre prenotazioni. L'inserimento finale è comunque protetto dal vincolo di esclusione: se due clienti prendono lo stesso slot in contemporanea, il secondo riceve un errore gestito ("Orario appena occupato, scegline un altro").

---

## 5. Funzionalità – lato cliente (mobile / PWA)

1. **Home**: info negozio, pulsante "Prenota", prossima prenotazione in evidenza.
2. **Flusso di prenotazione** (max 4 schermate):
   1. scelta servizio (nome, durata, prezzo);
   2. scelta barbiere (con foto) oppure "Nessuna preferenza";
   3. scelta giorno (striscia orizzontale di date) e orario (griglia di slot);
   4. riepilogo + note opzionali + conferma.
3. **Le mie prenotazioni**: future e passate; cancellazione consentita fino a `cancel_limit_min` prima, poi pulsante "Chiama il negozio".
4. **Profilo**: nome, telefono, email, consensi, eliminazione account.
5. **Registrazione/login**: email con magic link + login Google (vedi domande aperte). Il telefono è obbligatorio in profilo per essere contattabili.
6. **Installazione PWA**: banner che spiega come aggiungere l'app alla schermata Home (istruzioni specifiche per iOS).

## 6. Funzionalità – lato admin (web)

1. **Calendario giornaliero** con una colonna per barbiere, vista settimanale, navigazione per data; click su slot vuoto → nuova prenotazione manuale; click su prenotazione → dettaglio e cambio stato.
2. **Prenotazione manuale**: ricerca cliente esistente o inserimento rapido nome + telefono.
3. **Spostamento prenotazione** (cambio orario/barbiere) con verifica sovrapposizioni.
4. **Servizi**: CRUD, ordinamento, attivazione.
5. **Barbieri**: CRUD, servizi abilitati, orari settimanali, assenze.
6. **Chiusure negozio**.
7. **Clienti**: elenco con ricerca, storico prenotazioni, contatore no-show, blocco/sblocco.
8. **Impostazioni**: i parametri della sezione 3.1.
9. **Statistiche base**: prenotazioni e incasso stimato per giorno/settimana/mese, per barbiere e per servizio, tasso di no-show.

## 7. Notifiche (MVP)

- Email al cliente: conferma prenotazione, cancellazione (da chiunque), promemoria **24 ore prima**.
- Email/indicatore in dashboard allo staff per nuove prenotazioni e cancellazioni online.
- Promemoria inviati da un job schedulato (Supabase cron / Edge Function) ogni 15 minuti, con flag per non inviare doppioni.

Rimandati: push notification PWA, SMS, WhatsApp.

## 8. Privacy e sicurezza

- Informativa privacy e consenso esplicito al trattamento in registrazione; consenso marketing separato e facoltativo.
- Dati raccolti minimi: nome, email, telefono, storico prenotazioni.
- Eliminazione account da parte del cliente → anonimizzazione delle prenotazioni passate (restano per le statistiche senza dati personali).
- Row Level Security attiva su **tutte** le tabelle; nessuna chiave privilegiata nel codice client.
- Rate limiting sulla creazione prenotazioni per evitare abusi.

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
| 3 | Admin: servizi, barbieri, orari, assenze, chiusure | CRUD completi |
| 4 | Motore disponibilità | Test unitari sui casi limite verdi (sez. 12) |
| 5 | Flusso prenotazione cliente + "Le mie prenotazioni" | Prenotazione e cancellazione end-to-end con Playwright |
| 6 | Calendario admin + prenotazioni manuali + cambi stato | Staff gestisce una giornata intera |
| 7 | Notifiche email e promemoria | Email ricevute in ambiente di test |
| 8 | PWA (manifest, icone, installazione) + rifinitura UI | Installabile su iOS e Android |
| 9 | Statistiche, privacy, eliminazione account | Pronto per il primo uso reale |

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
4. Le assenze inserite dai barbieri richiedono approvazione dell'admin?
5. Le prenotazioni online vanno confermate a mano o sono automatiche?
6. Serve una caparra o il pagamento anticipato per ridurre i no-show?
7. Chi riceve le notifiche lato negozio e su quale canale?
8. Nome e dominio dell'app, logo e colori del negozio.
