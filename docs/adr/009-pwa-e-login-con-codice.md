# ADR 009 – PWA e login con codice a 6 cifre

Data: 2026-10-10 · Stato: accettata · Fetta 8

## Contesto

La SPEC §5.6 e §11 chiedono un'app installabile su iOS e Android. Su iPhone l'app aggiunta alla schermata Home ha cookie separati da Safari: il magic link dell'email si apre in Safari e la sessione nasce lì, non nell'app installata. Serve un modo di entrare che apra la sessione dove l'accesso è stato chiesto.

Un'app installabile richiede manifest, icone e (per Chromium) un service worker. Un service worker che mette in cache pagine o dati rischia di mostrare dati personali vecchi o di un altro utente, e un errore nel worker resta installato nei browser dei clienti anche dopo il deploy di una correzione.

## Decisione

**Login con codice**
- Le email di accesso (`supabase/templates/magic_link.html` e `confirmation.html`) contengono il codice a 6 cifre (`{{ .Token }}`) e, come alternativa, il link di sempre (ADR 002). Codice e link scadono dopo 15 minuti (`otp_expiry = 900`).
- In `/accedi`, dopo l'invio, il cliente digita il codice. La server action `verifyLoginCode` lo verifica con `verifyOtp({ email, token, type: "email" })` su un client senza cookie e apre la sessione con le stesse regole del link: solo clienti (lo staff va a `/admin/login` senza sessione), stesse destinazioni (`next`, `/profilo/completa` al primo accesso).
- GoTrue non distingue un codice sbagliato da uno scaduto: un solo messaggio, "Codice non valido o scaduto", con i tentativi rimasti.
- **Limite dei tentativi**, nostro perché GoTrue limita solo per IP e le verifiche partono dal server dell'app. Tabella `login_code_attempts` con l'hash sha256 dell'email normalizzata (trim + minuscole), mai l'email in chiaro; RLS attiva senza policy; funzioni `login_code_check`, `login_code_register_failure`, `login_code_reset`, `login_code_clear` eseguibili solo da `service_role`, chiamate da `src/lib/auth/login-code.ts` (server-only, unica eccezione aggiunta all'elenco chiuso dei file che usano la service role).
  - 5 errori per codice: si azzerano quando si chiede un nuovo codice, solo se l'email è partita davvero.
  - 10 errori per email in una finestra fissa di un'ora dal primo errore: un nuovo codice non li azzera.
  - Login riuscito: azzera entrambi i contatori.
  - Oltre il limite il codice non viene nemmeno verificato; resta il link.
  - Un errore di rate limit di GoTrue (429) non conta come tentativo; se il database non risponde, il codice non si verifica ("Troppe richieste, riprova tra poco").
- **Il contatore è una difesa in più, non il limite vero.** Chi chiama direttamente l'endpoint di verifica di Supabase (`/auth/v1/verify`, con la chiave pubblica) non passa dall'app e quindi non dal contatore; lo stesso vale per richieste parallele, che possono superare il limite di qualche tentativo perché controllo e conteggio sono passi separati (accettato in review, non si rende atomico). Le protezioni vere sono il limite per IP di Supabase, la scadenza di 15 minuti e lo spazio di 10^6 codici: con 30 verifiche ogni 5 minuti per IP, in 15 minuti un IP prova al massimo 90 codici su un milione. Il contatore serve a fermare chi prova dall'app e a dare al cliente un messaggio chiaro.
- **Invio rifiutato da Supabase**: `requestMagicLink` non risponde più "inviato" quando l'email non parte. Con un 429 (intervallo minimo tra due email, 60 s in produzione, o tetto orario) il modulo dice di aspettare e non mostra il campo del codice; con altri errori dice che l'invio non è riuscito. Il contatore del codice non si azzera. **Rischio di enumerazione accettato**: con `shouldCreateUser` anche un indirizzo nuovo riceve l'email, quindi l'errore non rivela se l'account esiste; il 429 rivela solo che nell'ultimo minuto qualcuno ha chiesto un codice per quell'indirizzo.
- **Effetto collaterale accettato**: chi conosce l'email di un cliente può bloccargli il codice per un'ora sbagliando apposta; il link continua a funzionare.
- **Limite per IP di GoTrue** (`token_verifications`, 30 ogni 5 minuti per IP nel cloud): le verifiche partono dalle funzioni di Vercel, quindi molti clienti condividono pochi IP. In locale il limite è alzato a 300 per gli e2e. Se in produzione diventasse un problema (errori "Troppe richieste" nei log con pochi clienti), la via d'uscita è verificare il codice dal browser del cliente (`verifyOtp` con il client del browser, che conta sull'IP del cliente) mantenendo il controllo dei tentativi lato server: una server action controlla e registra i tentativi prima e dopo la verifica, e la sessione passa al server solo dopo la lettura del ruolo, come oggi.

**Manifest e icone**
- `src/app/manifest.ts`: nome dalle impostazioni (`shop_settings.name`), nome breve = prima parola, `display: "standalone"`, `start_url` e `scope` `/` (anche lo staff può usare l'app installata), colori da `appIdentity` del tema.
- Icone generate con `next/og` dal disegno del tema (`appIconSvg`, trasformato in data URI solo lato server da `src/lib/pwa/icons.ts`, così non finisce nel codice scaricato dal browser; `src/app/icon.tsx` a 192 e 512 px, `src/app/apple-icon.tsx` a 180 px per iOS): disegno a tutto campo con la mosca nella zona sicura, quindi la 512 vale anche come `maskable`. Nessun PNG nel repo: cambiando tema cambiano anche le icone.
- iOS: `appleWebApp` con titolo breve e barra di stato `default` (la pagina resta sotto la barra, niente `viewport-fit=cover`).

**Installazione**
- Banner solo in home: istruzioni su iOS ("Condividi → Aggiungi alla schermata Home"), pulsante "Installa" dove il browser invia `beforeinstallprompt`, niente altrove; mai nell'app già installata. "Non ora" lo chiude per sempre su quel dispositivo (`localStorage`). Voce fissa "Installa l'app" nel profilo.

**Service worker** (`public/sw.js`, registrato solo nella build di produzione)
- In cache solo i file statici di Next (`/_next/static/`, nomi con hash), le icone e la pagina `/offline`, salvata all'installazione.
- Navigazioni sempre in rete; senza rete, la pagina `/offline`.
- **La pagina offline è HTML statico senza JavaScript dell'app** (`src/app/offline/route.ts`, generata alla build). Stili inline con le variabili del `theme.css` del tema attivo (`themeName` in `src/themes/active.ts`), font di sistema e "Riprova" che ricarica la pagina corrente. Prima era una pagina Next. Nella prova su iPhone, senza rete, si idratava e chiedeva i propri script (`next/link`), che non erano in cache perché `/offline` si salva all'installazione solo come HTML. Next mostrava allora la sua schermata d'errore ("This page couldn't load"). Una pagina senza script non dipende dalla cache dei file statici e non viene idratata sull'indirizzo richiesto. Tutto il resto (POST e server action, dati RSC, `/auth`, `/admin`, API, manifest, altre origini) non passa dalla cache del worker.
- Una cache per deploy: la versione è il commit del deploy (`VERCEL_GIT_COMMIT_SHA`, poi `VERCEL_DEPLOYMENT_ID`, fuori da Vercel `local`), calcolata al build in `next.config.ts` (`src/lib/pwa/sw-version.ts`) e passata da `register-sw.tsx` come `/sw.js?v=<versione>`. Con un URL nuovo il browser installa il nuovo worker, che all'attivazione cancella le cache dei deploy precedenti: niente file statici accumulati, icone e pagina `/offline` sempre del deploy corrente, nessuna costante da aggiornare a mano. `/sw.js` è servito con `Cache-Control: no-cache`, così gli aggiornamenti arrivano al primo controllo.
- **Interruttore d'emergenza**: `public/sw-kill-switch.js`. Se il worker in produzione causa problemi, si copia `sw-kill-switch.js` su `public/sw.js` e si pubblica: alla visita successiva il browser installa il nuovo worker, che svuota tutte le cache, si deregistra e ricarica le pagine aperte. Si ripristina il worker normale solo dopo aver corretto il problema (il nuovo deploy ha già una versione nuova). Finché l'interruttore è pubblicato, la pagina continua a registrare `/sw.js` a ogni visita e l'interruttore si deregistra subito: nessuna cache e nessuna richiesta intercettata. Verificato sulla build di produzione il 2026-10-10: dopo l'aggiornamento il worker si deregistra e le cache si svuotano in circa 1,5 s.

**Eccezione a `requireRole`**: `manifest.webmanifest`, le icone (`/icon/*`, `/apple-icon`) e `/offline` (route handler statico) sono pubblici, non leggono la sessione e non contengono dati personali (al massimo il nome del negozio). Come il callback dell'ADR 002, non chiamano `requireRole`; `decideAccess` li consente a tutti.

## Conseguenze

- Il login con codice funziona in produzione solo con SMTP proprio e template personalizzati: il template predefinito di Supabase contiene solo il link (`docs/GO-LIVE.md` §3). Sul cloud la scadenza di 15 minuti si imposta dalla dashboard.
- Il codice si può digitare anche su un dispositivo diverso da quello in cui si legge l'email.
- Le icone si generano alla prima richiesta e restano in cache; un cambio di tema richiede un nuovo deploy.
- Niente notifiche push in questa fetta.
