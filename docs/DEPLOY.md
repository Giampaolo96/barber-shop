# Deploy

L'app gira su Vercel, il database su Supabase cloud. Questi passi richiedono i tuoi account: Claude non fa push né deploy.

Prima dell'uso reale con i clienti va completata la checklist in `docs/GO-LIVE.md` (dominio, email, piani dei fornitori, privacy, proprietà degli account).

## 1. Repository GitHub
1. Crea un repository vuoto su GitHub (privato).
2. Dalla root del progetto:
   ```
   git remote add origin https://github.com/<utente>/barber-shop.git
   git push -u origin main
   ```
3. Nella scheda **Actions** verifica che il workflow `CI` sia verde: è il criterio "test che girano in CI" della fetta 0.

## 2. Vercel
1. Su https://vercel.com: **Add New → Project → Import** del repository.
2. Framework: Next.js (rilevato in automatico). Nessuna impostazione di build da cambiare.
3. In **Settings → General → Node.js Version** scegli la 24.x, come in `.nvmrc` e in `engines`.
4. Deploy. L'URL `https://<progetto>.vercel.app` deve mostrare la pagina segnaposto con il nome del negozio.

Ogni push su `main` produce un deploy di produzione; ogni pull request un deploy di anteprima.

## 3. Variabili d'ambiente
Per la fetta 0 non ne serve nessuna. Dalla fetta 1–2, con il progetto Supabase cloud creato, vanno impostate in **Settings → Environment Variables** quelle elencate in `.env.example`:

| Variabile | Dove si usa | Note |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client e server | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client e server | pubblica, protetta dalle policy RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | solo server | mai con prefisso `NEXT_PUBLIC_`; serve dalla fetta 3 per creare gli account staff e revocarne le sessioni (ADR 003) |
| `RESEND_API_KEY` | solo server | |

## 4. Migrazioni sul database cloud
Le migrazioni si applicano con `npx supabase db push` dopo `npx supabase link`. È un'operazione che fai tu a mano: per Claude il comando è bloccato.

Non usare `--include-seed`: il seed crea utenti demo con password nota.

## 5. Progetto Supabase cloud e autenticazione
1. Crea il progetto su https://supabase.com (regione UE) e copia URL e chiave pubblica nelle variabili di Vercel (sezione 3).
2. **Authentication → URL Configuration**: `Site URL` = URL di produzione dell'app (es. `https://<progetto>.vercel.app`). I link delle email usano questo valore.
3. **Authentication → Email Templates**: nei template *Magic Link* e *Confirm signup* incolla il contenuto di `supabase/templates/magic_link.html` e `confirmation.html`. Il link deve restare `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}`: `next` riporta il cliente alla pagina da cui è partito (es. il flusso di prenotazione).
   In **Authentication → URL Configuration → Redirect URLs** aggiungi `https://<dominio>/**`: se l'URL di redirect non è ammesso, Supabase usa il Site URL e il cliente, dopo il login, torna alla home invece che alla pagina di partenza.
4. **Authentication → Providers → Email**: conferma dell'email attiva, lunghezza minima della password 10, cambio password sicuro attivo (come in `supabase/config.toml`, che vale solo in locale).
5. **Ripiego senza template personalizzato** (solo finché manca l'SMTP proprio): con il template predefinito di Supabase il link passa da `/auth/v1/verify` e torna all'app con `?code=` (flusso PKCE) oppure con `?error=…&error_code=…` se il link è scaduto o già usato. L'app lo gestisce:
   - il proxy rimanda `/?code=` e `/auth/confirm?code=` a `/auth/callback`, che scambia il codice e apre la sessione solo ai clienti (per lo staff la revoca);
   - un errore nella query o nel fragment porta a `/accedi?errore=link`.

   Limiti del ripiego:
   - il link funziona solo nel browser che l'ha richiesto (il `code_verifier` è in un cookie);
   - vale solo l'ultimo link richiesto da quel browser: ogni richiesta sostituisce il `code_verifier`, quindi un link precedente porta a `/accedi?errore=link`;
   - il token si consuma all'apertura, quindi uno scanner della posta può invalidarlo prima del cliente;
   - la destinazione di ritorno si conserva solo se `https://<dominio>/**` è tra i Redirect URLs.

   Con l'SMTP e i template del punto 3 il flusso principale (`/auth/confirm` con conferma tramite pulsante) torna a essere l'unico usato, e il ripiego non serve più.
6. **SMTP proprio, obbligatorio per i clienti reali**: il servizio email predefinito di Supabase non è adatto alla produzione (pochi invii all'ora, consegna solo a indirizzi del team, nessuna garanzia di recapito). In **Authentication → SMTP Settings** configura un provider tuo, ad esempio Resend, con un dominio mittente verificato (SPF e DKIM).
7. **Limiti di invio e abusi**: l'app non limita da sé le richieste di magic link, ci pensa Supabase. In **Authentication → Rate Limits** lascia almeno 60 secondi tra due email allo stesso indirizzo e imposta il tetto orario di email in base al piano del provider SMTP (i valori di `supabase/config.toml`, come `max_frequency = "1ms"`, valgono solo in locale e in CI e servono ai test). Se compaiono richieste automatiche, attiva il CAPTCHA in **Authentication → Attack Protection** (Turnstile o hCaptcha): in quel caso il form di `/accedi` va adeguato per inviare il token del CAPTCHA.
8. Login con Google: rimandato. Quando serve, vanno create le credenziali OAuth su Google Cloud e attivato il provider.

## 6. Primo admin
Lo staff non si registra da solo. Per creare il primo admin:
1. In **Authentication → Users → Add user** crea l'utente con email e password (almeno 10 caratteri) e conferma automatica dell'email.
2. Nell'SQL Editor promuovilo:
   ```sql
   update public.profiles set role = 'admin', full_name = 'Nome Cognome'
    where id = (select id from auth.users where email = 'titolare@esempio.it');
   ```
3. L'admin entra da `/admin/login`. Gli account dei barbieri si creano dalla scheda del barbiere in `/admin/barbieri` (ADR 003).

## 7. Rate limiting (firewall Vercel)
La creazione delle prenotazioni è limitata nel database, per cliente (al massimo 3 prenotazioni online future e 10 creazioni nelle ultime 24 ore, ADR 005). La consultazione degli orari no: le pagine del flusso (`/prenota/**`) richiedono il login, ma un cliente autenticato potrebbe aprirle in continuazione, e ogni apertura di `/prenota/orario` calcola i giorni liberi su tutto l'orizzonte. Un limitatore in memoria non funziona sulle funzioni serverless, e uno nel database eseguibile dai clienti sarebbe usabile per bloccare altri utenti.

Lo stesso vale per `/accedi`: la verifica del codice a 6 cifre parte dai server di Vercel, quindi chi prova codici a raffica (anche con email sempre diverse, che il contatore per email non ferma) consuma il limite di verifiche per IP di Supabase, condiviso da tutti i clienti (ADR 009).

Per frenare le richieste automatiche configura una regola di rate limiting del firewall Vercel (disponibile anche sul piano Hobby, **una sola regola** per progetto; finestra fissa da 10 s a 10 min, chiave IP). Prenotazione e accesso stanno nella stessa regola, con due condizioni in OR:
1. Progetto → **Firewall** → **Configure** → **New Rule**.
2. Condizioni, **qualsiasi metodo**:
   - *Request Path* che inizia con `/prenota`: le pagine del flusso (GET, compresa `/prenota/orario`) e le server action, che sono POST sulla pagina;
   - **OR** (*Add Or*, un secondo gruppo di condizioni) *Request Path* uguale a `/accedi`: invio dell'email e verifica del codice, entrambi server action in POST sulla pagina.
3. Azione **Rate Limit**, *Fixed Window* 60 s, limite indicativo 60 richieste per IP (il conteggio è unico per le due pagine), risposta 429. Conviene partire con l'azione **Log** per qualche giorno e controllare il traffico prima di passare al blocco.
4. **Review Changes** → **Publish**.

## 8. App installata (PWA, ADR 009)
Il service worker si registra solo nella build di produzione e richiede HTTPS: si prova sul deploy di Vercel, non con `npm run dev`.
1. **Controllo dal computer** (Chrome, DevTools → *Application*): *Manifest* senza errori, con nome del negozio e icone; *Service workers* con `/sw.js` attivo; *Cache storage* con la sola cache `barber-shop-static-*` (pagina `/offline`, file `/_next/static/` e icone, nessuna pagina).
2. **iPhone** (Safari): apri il sito, in home compare il banner con le istruzioni. *Condividi → Aggiungi alla schermata Home*: l'icona è la mosca su fondo scuro, il nome è la prima parola del negozio.
3. Dall'app installata: *Accedi*, inserisci l'email, leggi il codice nell'email (anche da un altro dispositivo) e digitalo nell'app. La sessione deve aprirsi nell'app, non in Safari. Poi completa una prenotazione: le pagine si aprono dentro l'app, senza barra del browser.
4. **Android** (Chrome): in home compare il pulsante *Installa*; dopo l'installazione ripeti il punto 3.
5. **Offline**: con la modalità aereo, aprendo l'app compare la pagina "Sei offline" e resta visibile, senza la schermata d'errore di Next. *Riprova* senza rete la ripropone; tornata la rete, riapre la pagina richiesta.
6. **Interruttore d'emergenza**: se il service worker causa problemi, copia `public/sw-kill-switch.js` su `public/sw.js` e pubblica. Alla visita successiva le cache si svuotano e il worker si deregistra (in DevTools *Service workers* non c'è più nulla). Ripristina il worker normale solo dopo aver corretto il problema: ogni deploy ha già la sua versione della cache (commit del deploy, ADR 009).
