# Setup su Windows

## 1. Prerequisiti (PowerShell)
```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install Docker.DockerDesktop
```
- Riavvia il terminale dopo l'installazione.
- Docker Desktop: al primo avvio accetta il backend WSL 2 e lascialo aperto quando lavori con il DB locale.
- Supabase CLI non va installata a parte: si usa con `npx supabase` dopo averla aggiunta al progetto (lo fa Claude nella fetta 0).

Verifica:
```powershell
git --version
node --version
docker --version
```

## 2. Claude Code
Installa Claude Code seguendo la guida ufficiale per Windows (https://code.claude.com/docs). Su Windows nativo usa Git Bash per eseguire i comandi, quindi Git deve essere installato.
Puoi usarlo da terminale, dall'estensione VS Code o dalla scheda Code dell'app desktop.

## 3. Repo
```powershell
cd C:\progetti
# estrai qui barber-shop.zip
cd barber-shop
git init
git add .
git commit -m "chore: specifica e configurazione Claude Code"
```
Avvia sempre Claude Code **dalla cartella `barber-shop`**: l'hook usa un percorso relativo.

## 4. Primo avvio
```powershell
claude
```
Al primo avvio conferma la fiducia nella cartella, poi:
```
/slice 0
```
La fetta 0 crea il progetto Next.js, aggiunge Supabase e gli script `lint`, `typecheck`, `test`, `test:e2e`. Se `create-next-app` si rifiuta di lavorare in una cartella non vuota, Claude può crearlo in una sottocartella temporanea e spostare i file.

## 5. Ciclo di lavoro
- Una fetta per sessione: `/slice <n>`, approva il piano, rivedi i test, lascia implementare, leggi il report di review, committa.
- Tra una fetta e l'altra: `/clear`.
- Lo stato è sempre in `docs/PROGRESS.md`.

## Problemi comuni
- **L'hook non parte o dà errore di policy**: il comando usa già `-ExecutionPolicy Bypass`. Verifica che Claude Code sia stato avviato dalla root del repo.
- **Il gate gira dopo ogni risposta**: succede solo se ci sono modifiche non committate in `src/`, `supabase/migrations/` o `supabase/seed.sql` (le cartelle dei test non contano). Committa a fine passo.
- **`npx supabase start` fallisce**: Docker Desktop non è avviato.
- **Fine riga**: `.gitattributes` forza LF per tutto tranne gli script `.ps1`; non disattivarlo.
