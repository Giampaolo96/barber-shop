# Deploy

L'app gira su Vercel, il database su Supabase cloud. Questi passi richiedono i tuoi account: Claude non fa push né deploy.

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
| `SUPABASE_SERVICE_ROLE_KEY` | solo server | mai con prefisso `NEXT_PUBLIC_` |
| `RESEND_API_KEY` | solo server | |

## 4. Migrazioni sul database cloud
Le migrazioni si applicano con `npx supabase db push` dopo `npx supabase link`. È un'operazione che fai tu a mano: per Claude il comando è bloccato.

Non usare `--include-seed`: il seed crea utenti demo con password nota.

## 5. Progetto Supabase cloud e autenticazione
1. Crea il progetto su https://supabase.com (regione UE) e copia URL e chiave pubblica nelle variabili di Vercel (sezione 3).
2. **Authentication → URL Configuration**: `Site URL` = URL di produzione dell'app (es. `https://<progetto>.vercel.app`). I link delle email usano questo valore.
3. **Authentication → Email Templates**: nei template *Magic Link* e *Confirm signup* incolla il contenuto di `supabase/templates/magic_link.html` e `confirmation.html`. Il link deve restare `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.
4. **Authentication → Providers → Email**: conferma dell'email attiva, lunghezza minima della password 10, cambio password sicuro attivo (come in `supabase/config.toml`, che vale solo in locale).
5. **SMTP proprio, obbligatorio per i clienti reali**: il servizio email predefinito di Supabase non è adatto alla produzione (pochi invii all'ora, consegna solo a indirizzi del team, nessuna garanzia di recapito). In **Authentication → SMTP Settings** configura un provider tuo, ad esempio Resend, con un dominio mittente verificato (SPF e DKIM).
6. **Limiti di invio e abusi**: l'app non limita da sé le richieste di magic link, ci pensa Supabase. In **Authentication → Rate Limits** lascia almeno 60 secondi tra due email allo stesso indirizzo e imposta il tetto orario di email in base al piano del provider SMTP (i valori di `supabase/config.toml`, come `max_frequency = "1s"`, valgono solo in locale e servono ai test). Se compaiono richieste automatiche, attiva il CAPTCHA in **Authentication → Attack Protection** (Turnstile o hCaptcha): in quel caso il form di `/accedi` va adeguato per inviare il token del CAPTCHA.
7. Login con Google: rimandato. Quando serve, vanno create le credenziali OAuth su Google Cloud e attivato il provider.

## 6. Primo admin
Lo staff non si registra da solo. Per creare il primo admin:
1. In **Authentication → Users → Add user** crea l'utente con email e password (almeno 10 caratteri) e conferma automatica dell'email.
2. Nell'SQL Editor promuovilo:
   ```sql
   update public.profiles set role = 'admin', full_name = 'Nome Cognome'
    where id = (select id from auth.users where email = 'titolare@esempio.it');
   ```
3. L'admin entra da `/admin/login`. Gli account dei barbieri si gestiranno dall'area admin (fetta 3).
