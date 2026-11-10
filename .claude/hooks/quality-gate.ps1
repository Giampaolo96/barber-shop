# Quality gate (hook Stop) - Windows PowerShell 5.1+
# Quando Claude sta per chiudere il turno e ci sono modifiche non committate
# di implementazione (src, migrazioni, seed), esegue lint, typecheck e test uno dopo l'altro e si
# ferma al primo che fallisce: esce con codice 2, Claude non si ferma e riceve l'errore come feedback.
# Vitest gira su 2 processi: con tutti i core i test unitari andavano in timeout (5 s) sotto carico.

$ErrorActionPreference = 'Continue'

if ($env:CLAUDE_PROJECT_DIR) {
    $projectDir = $env:CLAUDE_PROJECT_DIR
} else {
    $projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}
Set-Location $projectDir

# Input JSON dell'hook: stop_hook_active = true se Claude sta gia'
# continuando per colpa di questo hook. In quel caso lo lasciamo fermare,
# per evitare loop infiniti: dovra' riportare il problema all'utente.
$stopHookActive = $false
try {
    $raw = [Console]::In.ReadToEnd()
    if ($raw) {
        $payload = $raw | ConvertFrom-Json
        if ($payload.stop_hook_active) { $stopHookActive = $true }
    }
} catch { }

# Progetto non ancora inizializzato: niente da verificare
if (-not (Test-Path 'package.json')) { exit 0 }

# Nessuna modifica di implementazione: turno di sola conversazione, oppure
# solo test (quelli di accettazione nascono rossi, prima del codice)
$changes = git status --porcelain -- src supabase/migrations supabase/seed.sql 2>$null
if (-not $changes) { exit 0 }

if ($stopHookActive) { exit 0 }

$checks = @(
    @{ Label = 'lint';      Args = @('run', 'lint', '--silent') },
    @{ Label = 'typecheck'; Args = @('run', 'typecheck', '--silent') },
    @{ Label = 'test';      Args = @('test', '--silent', '--', '--maxWorkers=2') }
)

foreach ($check in $checks) {
    $npmArgs = $check.Args
    $output = & npm @npmArgs 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        $tail = ($output -split "`r?`n" | Select-Object -Last 60) -join "`n"
        [Console]::Error.WriteLine("QUALITY GATE FALLITO: $($check.Label)")
        [Console]::Error.WriteLine("Ci sono modifiche non committate e i controlli non passano. Correggi prima di chiudere il turno; se non e' possibile, spiega all'utente cosa fallisce e perche'.")
        [Console]::Error.WriteLine($tail)
        exit 2
    }
}

exit 0
