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
  Il ritorno alla pagina di partenza dopo il login (es. nel mezzo di una prenotazione) dipende da questi template (parametro `next={{ .RedirectTo }}`), quindi dall'SMTP proprio: senza, il cliente torna sempre alla home.
  Finché mancano SMTP e template, l'accesso funziona con il ripiego `/auth/callback` (template predefinito, `?code=`), con i limiti descritti in `docs/DEPLOY.md` §5 (link valido solo nel browser della richiesta, consumato all'apertura). Il ripiego serve solo fino a questo punto della checklist.
- [ ] **Rate limit delle email** in *Authentication → Rate Limits*, tarati sul piano Resend; CAPTCHA pronto da attivare in caso di abusi (`docs/DEPLOY.md` §5).
- [ ] **Valutazione del piano Pro**: nel piano gratuito i progetti inattivi vengono messi in pausa e i backup sono limitati. Per un negozio che lavora tutti i giorni servono backup giornalieri e nessuna pausa.
- [ ] Migrazioni applicate (`npx supabase db push`), **senza seed**: gli utenti demo hanno una password nota.
- [ ] Primo admin creato per il titolare (`docs/DEPLOY.md` §6) e account demo assenti.

## 4. Vercel
- [ ] Account o team intestato al titolare, su un **piano che consente l'uso commerciale**: il piano Hobby è solo per uso personale e non commerciale.
- [ ] **Dominio personalizzato** collegato al progetto (es. `prenota.nomenegozio.it`), con HTTPS attivo.
- [ ] Variabili d'ambiente di produzione impostate (`docs/DEPLOY.md` §3), compresa la chiave Resend per l'app.
- [ ] In Supabase, *Authentication → URL Configuration*:
  - [ ] **Site URL** = dominio personalizzato (i link delle email lo usano);
  - [ ] **Redirect URLs** aggiornati al dominio personalizzato (`https://<dominio>/**`, serve al ritorno dopo il login); via quelli di prova non più necessari.
- [ ] Regola di **rate limiting del firewall** sul flusso di prenotazione (`docs/DEPLOY.md` §7).
- [ ] Prova end-to-end in produzione: magic link di un cliente, login dello staff, prenotazione e cancellazione.

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
