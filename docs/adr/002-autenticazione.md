# ADR 002 – Autenticazione, ruoli e consensi

Data: 2026-10-02 · Stato: accettata · Fetta 2

## Contesto

La SPEC §5.5 chiede il login dei clienti con magic link (e Google, rimandato) e il telefono obbligatorio; la §2 distingue cliente, barbiere e admin; la §8 chiede consenso esplicito alla privacy e consenso marketing separato. La SPEC non definisce il login dello staff né come si raccolgono i consensi con un login senza form di registrazione.

## Decisione

**Login**
- Clienti: magic link via email. Il template (`supabase/templates/magic_link.html`, e `confirmation.html` per il primo accesso di un indirizzo nuovo) porta a `/auth/confirm?token_hash=...&type=email` sull'app. Aprire il link (GET) mostra solo una pagina con il pulsante "Accedi" e non consuma il token, perché gli scanner dei provider di posta visitano i link prima dell'utente; il pulsante invia una POST a una server action che verifica il token con `verifyOtp`. Il link funziona anche se aperto in un browser diverso da quello della richiesta. Niente Google per ora (servono credenziali OAuth), niente SMS.
- Staff: email + password su `/admin/login`, senza auto-registrazione. Il magic link non apre mai una sessione staff: la server action di `/auth/confirm` verifica il token con un client senza cookie, legge il ruolo e per lo staff revoca la sessione appena creata e rimanda a `/admin/login`. Il primo admin si promuove via SQL (vedi `docs/DEPLOY.md`).
- Logout solo con server action (POST da un form), mai con un link; dopo il logout si va su `/`.
- Nessuna enumerazione degli account: l'invio del magic link risponde sempre allo stesso modo; `/admin/login` risponde "Credenziali non valide" per email inesistente, password sbagliata e account cliente (che viene subito disconnesso).

**Ruolo e sessione**
- Il ruolo si legge solo da `profiles`, con una query lato server; mai da `user_metadata` o `app_metadata` del JWT. Un utente senza riga in `profiles` non ha alcun ruolo.
- Lato server l'utente si verifica con `getUser()` (layout, server action, route) o `getClaims()` (proxy), mai con `getSession()`.
- **Sessione revocata ancora nei cookie** (aggiunto il 2026-10-11, bug in produzione su Safari iOS). `getClaims()` verifica il JWT in locale e non vede una sessione chiusa altrove (logout dall'app installata, che su iOS parte con una copia dei cookie di Safari, oppure una revoca). Le pagine invece, con `getUser()`, vedono un anonimo. Senza correzione il proxy rimandava `/accedi` e `/admin/login` alla home, mentre l'header mostrava "Accedi". Ora, quando la decisione è un redirect dovuto all'utente loggato, il proxy conferma la sessione con `getUser()` (`resolveAccess` in `src/lib/auth/stale-session.ts`). Se la sessione non esiste più, il proxy cancella i cookie `sb-…-auth-token` e decide come per un anonimo. Le richieste consentite non pagano la chiamata in più. Un errore di rete lascia la decisione di partenza.
- `decideAccess` (`src/lib/auth/access.ts`) è una funzione pura che decide `allow` o `redirect` da percorso, ruolo, blocco e completezza del profilo. La applica `src/proxy.ts` prima del rendering; ogni pagina di `/admin` (non solo il layout, che non si riesegue a ogni navigazione) e le server action ricontrollano con `requireRole`. La RLS resta la protezione dei dati.
- Aree: `/admin/**` per lo staff (il barbiere solo `/admin` e `/admin/calendario`, ogni altra rotta è solo-admin per default); `/prenota/**`, `/prenotazioni/**` e `/profilo/**` sono pagine private del cliente. Lo staff non usa le pagine private del cliente e viene rimandato a `/admin`.
- Il parametro `next` di `/auth/confirm` passa da `safeNextPath`: solo percorsi relativi interni.
- **Ripiego per il template predefinito** (aggiunto il 2026-10-06, finché manca l'SMTP con il template personalizzato). Il link predefinito passa da `/auth/v1/verify` e torna all'app con `?code=` (PKCE). Il proxy (`emailLinkFallback`) rimanda `/?code=` e `/auth/confirm?code=` al route handler `GET /auth/callback`, che fa lo scambio con `exchangeCodeForSession`:
  - tiene in sospeso i cookie della nuova sessione e legge il ruolo;
  - cliente: applica i cookie e segue la stessa destinazione del flusso principale (`n` → `safeNextPath`, `/profilo/completa` se il profilo è incompleto);
  - staff: `signOut({ scope: "local" })` sulla sola sessione nuova, nessun cookie, `/admin/login`; la sessione già aperta nel browser resta intatta;
  - codice non valido e parametri `error`/`error_code`, nella query (proxy) o nel fragment (componente client nell'area clienti): `/accedi?errore=link`.

  Eccezione approvata alla regola "ogni route handler chiama `requireRole`": è un callback di login e l'utente non è ancora autenticato; il ruolo si verifica dopo lo scambio, prima di dare la sessione al browser.
- `is_blocked`: al cliente non impedisce il login (blocca la prenotazione, fetta 5). Lo staff bloccato non entra in `/admin`: al login vede "Account disabilitato" e viene disconnesso; a sessione già aperta il proxy lo rimanda a `/admin/login` e toglie i cookie di sessione dal browser.

**Profilo e consensi**
- Al primo accesso il cliente completa il profilo su `/profilo/completa`: nome, telefono, consenso privacy obbligatorio, marketing facoltativo. Il profilo incompleto non blocca le pagine pubbliche, solo quelle private.
- Il telefono è normalizzato in E.164 (paese predefinito IT, `libphonenumber-js`) prima del salvataggio. `profiles.phone` resta nullable e senza vincolo di formato nel database.
- Colonne `privacy_consent_at`, `privacy_policy_version`, `marketing_consent`, `marketing_consent_at` su `profiles`. L'utente ha il grant di update solo su `privacy_policy_version` e `marketing_consent`; i timestamp li valorizza il trigger `profiles_guard_consents` con `now()`.
- Il consenso privacy si dà scrivendo la versione accettata, che deve coincidere con `shop_settings.privacy_policy_version` (versione corrente, modificabile solo dall'admin). Una volta dato non si revoca né si modifica dal profilo. Il marketing è revocabile e ogni cambio aggiorna il timestamp.
- I consensi li scrive solo l'interessato: nemmeno l'admin modifica quelli di un altro profilo.
- Il trigger di registrazione copia dai metadati solo il nome (`full_name`, altrimenti `name`, massimo 100 caratteri).

## Conseguenze

- Ogni pagina dell'area clienti legge il profilo a ogni richiesta (proxy e layout): accettabile ai volumi di un negozio.
- Il messaggio "Account disabilitato" compare solo dopo credenziali corrette, quindi non rivela l'esistenza di un account a chi non ne conosce la password.
- Lo staff bloccato perde i privilegi anche nel database: `is_admin()`, `is_staff()` e `current_barber_id()` ignorano un profilo bloccato, quindi le policy RLS lo trattano come un utente senza privilegi e un admin bloccato non può sbloccarsi da solo. Per lo staff bloccato a sessione aperta il proxy toglie i cookie dal browser; il refresh token non è revocato sul server, ma con quel token non si leggono né si scrivono dati dello staff.
- Quando cambia l'informativa, chi ha già dato il consenso resta sulla versione vecchia: la raccolta di un nuovo consenso è rimandata alla fetta 9.
- I testi delle email di accesso stanno in `supabase/templates/*.html` e gli oggetti in `supabase/config.toml`, non in `src/i18n/it.ts`: è un'eccezione inevitabile, perché le email le compone Supabase. `magic_link.html` e `confirmation.html` hanno lo stesso contenuto e vanno tenuti allineati; in cloud vanno copiati a mano nei template del progetto.
- In produzione serve un SMTP proprio e, per gli admin, va valutato il secondo fattore TOTP (fetta 9).
