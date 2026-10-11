# Go-live – prerequisiti per l'uso reale

Checklist da completare quando c'è l'accordo con il titolare del negozio, prima di aprire l'app ai clienti reali. **Tutto va intestato al titolare**: domini, account dei fornitori, metodi di pagamento e repository. Chi sviluppa ci accede come collaboratore o tramite un contratto di gestione.

I passi tecnici di dettaglio sono in `docs/DEPLOY.md`; qui c'è cosa deve esistere e chi lo possiede.

## 1. Dominio e DNS
- [ ] Dominio del negozio registrato a nome del titolare (es. `nomenegozio.it`), con accesso al pannello DNS.
- [ ] Sottodominio dedicato all'invio delle email (es. `mail.nomenegozio.it`), così la reputazione delle email transazionali resta separata da quella della posta del negozio.
- [ ] Record DNS per il sottodominio di invio:
  - [ ] **SPF** come indicato da Resend;
  - [ ] **DKIM** con le chiavi generate da Resend;
  - [ ] **DMARC** sul dominio (si parte con `p=none` e un indirizzo per i report, poi si passa a `quarantine` quando i report sono puliti).
- [ ] Verifica con un invio di prova che le email arrivino in posta in arrivo (Gmail, Outlook, iCloud) e non nello spam.

## 2. Resend (email)
- [ ] Account Resend intestato al titolare.
- [ ] Sottodominio di invio aggiunto e **verificato** (SPF e DKIM verdi).
- [ ] Due API key distinte, con il minimo dei permessi (solo invio):
  - [ ] una per **Supabase** (SMTP delle email di accesso: magic link e conferma);
  - [ ] una per **l'app** (`RESEND_API_KEY`, email transazionali della fetta 7).
  
  Chiavi separate si revocano e si ruotano in modo indipendente.
- [ ] Piano adeguato al volume previsto di email (accessi, conferme, cancellazioni, promemoria).

## 3. Supabase
- [ ] Progetto (o organizzazione) intestato al titolare, regione UE.
- [ ] **SMTP proprio** in *Authentication → SMTP Settings* con la chiave Resend per Supabase e il mittente del sottodominio di invio (`docs/DEPLOY.md` §5).
- [ ] **Template** *Magic Link* e *Confirm signup* copiati da `supabase/templates/magic_link.html` e `confirmation.html`, con nome e recapiti del negozio.
  Con questi template il link porta alla pagina di conferma dell'app (`/auth/confirm`, accesso con il pulsante) e riporta il cliente alla pagina di partenza (parametro `next={{ .RedirectTo }}`).
  I template contengono anche il **codice a 6 cifre** (`{{ .Token }}`), che serve a chi usa l'app installata su iPhone: lì il link si aprirebbe in Safari e non nell'app (ADR 009). Con il template predefinito il codice non c'è e dall'app installata si entra solo aprendo l'email nel browser.
- [ ] **Scadenza di codice e link a 15 minuti**: sul cloud si imposta dalla dashboard, in *Authentication → Providers → Email → Email OTP Expiration* = `900` secondi (`supabase/config.toml` vale solo in locale). Lunghezza del codice: 6 cifre.
- [ ] **Protezione del codice**: il contatore dei tentativi dell'app (5 per codice, 10 all'ora per email) è una difesa in più e si aggira chiamando Supabase direttamente. Le protezioni vere sono il limite per IP di Supabase (punto seguente), la scadenza di 15 minuti e lo spazio di 10^6 codici (ADR 009): non alzare la scadenza e non accorciare il codice.
- [ ] **Limite di verifiche per IP** (*Authentication → Rate Limits*, verifiche OTP): le verifiche del codice partono dai server di Vercel, quindi molti clienti condividono pochi IP. Dopo l'avvio controllare nei log errori 429 e "Troppe richieste"; se compaiono, alzare il limite o seguire la via d'uscita dell'ADR 009.
  Finché mancano SMTP e template, l'accesso funziona con il ripiego `/auth/callback` (template predefinito, `?code=`): anche così si torna alla pagina di partenza, purché `https://<dominio>/**` sia tra i Redirect URLs. I limiti sono in `docs/DEPLOY.md` §5 punto 5: link valido solo nel browser della richiesta e solo l'ultimo richiesto, consumato all'apertura. Il ripiego serve solo fino a questo punto della checklist.
- [ ] **Intervallo minimo tra due email allo stesso indirizzo = 60 s**, da verificare in dashboard (*Authentication → Rate Limits*): è allineato al pulsante "Invia di nuovo", disattivato per 60 s. `max_frequency` di `supabase/config.toml` vale solo in locale e in CI. Se l'intervallo non è passato, `/accedi` dice di aspettare e non mostra il campo del codice.
- [ ] **Rate limit delle email** in *Authentication → Rate Limits*, tarati sul piano Resend; CAPTCHA pronto da attivare in caso di abusi (`docs/DEPLOY.md` §5).
- [ ] **Valutazione del piano Pro**: nel piano gratuito i progetti inattivi vengono messi in pausa e i backup sono limitati. Per un negozio che lavora tutti i giorni servono backup giornalieri e nessuna pausa.
- [ ] Migrazioni applicate (`npx supabase db push`), **senza seed**: gli utenti demo hanno una password nota.
- [ ] Primo admin creato per il titolare (`docs/DEPLOY.md` §6) e account demo assenti.

## 4. Vercel
- [ ] Account o team intestato al titolare, su un **piano che consente l'uso commerciale**: il piano Hobby è solo per uso personale e non commerciale.
- [ ] **Dominio personalizzato** collegato al progetto (es. `prenota.nomenegozio.it`), con HTTPS attivo.
- [ ] Variabili d'ambiente di produzione impostate (`docs/DEPLOY.md` §3), compresa la chiave Resend per l'app.
- [ ] In Supabase, *Authentication → URL Configuration*:
  - [ ] **Site URL** = dominio personalizzato (i link delle email lo usano). Fino ad allora `https://barber-shop-jade-alpha.vercel.app`, il dominio pubblico: mai un URL del team (`barber-shop-<team>.vercel.app`), protetto dal login di Vercel;
  - [ ] **Redirect URLs** aggiornati al dominio personalizzato (`https://<dominio>/**`, serve al ritorno dopo il login); via quelli di prova non più necessari.
- [ ] Regola di **rate limiting del firewall** sul flusso di prenotazione e su `/accedi`, una sola regola con due condizioni in OR (`docs/DEPLOY.md` §7).
- [ ] Prova end-to-end in produzione: magic link di un cliente, login dello staff, prenotazione e cancellazione.
- [ ] Prova dell'app installata (`docs/DEPLOY.md` §8): installazione su iPhone e Android, accesso con il codice dall'app installata, prenotazione in modalità standalone, "Aggiungi al calendario" che apre il Calendario su iPhone.

## 5. Privacy (GDPR)
- [ ] **Informativa privacy** con i dati del titolare del negozio: ragione sociale, indirizzo, contatti, finalità, basi giuridiche, tempi di conservazione, diritti dell'interessato.
- [ ] **Ruoli del trattamento** definiti:
  - il negozio è **titolare** del trattamento;
  - chi sviluppa e gestisce l'app, se tratta dati per conto del negozio, è **responsabile** e va nominato con un accordo scritto (art. 28 GDPR);
  - i fornitori (Supabase, Vercel, Resend) sono sub-responsabili: accettare i rispettivi DPA dagli account del titolare.
- [ ] `shop_settings.privacy_policy_version` aggiornata alla versione pubblicata dell'informativa.
- [ ] Verifica con un consulente privacy, se il titolare lo ritiene necessario.

## 6. Proprietà di repository e account
- [ ] Decisione fra:
  - **trasferimento** al titolare di repository GitHub, progetti Vercel e Supabase, account Resend e dominio, con chi sviluppa come collaboratore;
  - oppure **contratto di gestione**, che stabilisce chi possiede codice, dati e account, chi paga i servizi, cosa succede alla fine del rapporto e come si restituiscono dati e accessi.
- [ ] Accessi personali di chi sviluppa ridotti al necessario e revocabili; credenziali condivise in un gestore di password, mai in chiaro.
- [ ] Inventario finale: dominio, DNS, GitHub, Vercel, Supabase, Resend, ciascuno con proprietario, metodo di pagamento e contatto di recupero.
