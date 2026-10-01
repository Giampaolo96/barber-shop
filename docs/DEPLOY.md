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
