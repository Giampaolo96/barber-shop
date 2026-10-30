# Barber Shop Booking

App di prenotazioni per un barber shop. Stack, comandi e regole di lavoro sono in `CLAUDE.md`; la specifica funzionale è in `docs/SPEC.md`.

## Strumenti per Claude Code

### SkillSpector (server MCP)

`.mcp.json` registra [SkillSpector](https://github.com/NVIDIA/skillspector) di NVIDIA, uno scanner di sicurezza per skill e agenti: espone il tool `scan_skill`, da usare prima di installare skill o plugin di terzi.

Installazione (una volta per macchina, serve [uv](https://docs.astral.sh/uv/)):

```
winget install --id=astral-sh.uv -e
uv tool install 'skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git'
uv tool update-shell   # facoltativo: mette skillspector nel PATH
```

uv scarica da solo Python 3.12+, richiesto da SkillSpector. `.mcp.json` punta a `${USERPROFILE}/.local/bin/skillspector.exe`, quindi funziona anche senza PATH. Al primo avvio di `claude` va approvato il server.

L'analisi LLM opzionale usa il login di Claude Code (`SKILLSPECTOR_PROVIDER=claude_cli`) e consuma quota; per la sola analisi statica chiama `scan_skill` con `use_llm=false`, o da terminale:

```
skillspector scan .claude/skills/ --recursive --no-llm
```

Aggiornamento: `uv tool update skillspector`.

### ponytail (plugin)

`.claude/settings.json` abilita per questo progetto il plugin [ponytail](https://github.com/DietrichGebert/ponytail): regole per la modifica più piccola che risolve il task (riusa ciò che c'è, niente astrazioni non richieste, mai tagliare validazione, sicurezza e test). In caso di conflitto valgono `CLAUDE.md` e `docs/SPEC.md`.

- Fissato al tag `v5.3.3` (`extraKnownMarketplaces`), rivisto e scansionato con SkillSpector prima dell'installazione: i finding critici erano in `benchmarks/` e `tests/`, che il plugin non esegue. Prima di alzare il tag, ripeti la revisione degli hook.
- Al primo `claude` nel repo viene chiesto di installare il marketplace e il plugin; serve Node nel PATH per gli hook.
- Le regole non vengono iniettate nel subagent `spec-qa` (`PONYTAIL_SUBAGENT_MATCHER` in `.claude/settings.json`), che scrive i test di accettazione.
- Livelli: `/ponytail lite|full|ultra|off`. Il plugin scrive solo in locale (flag in `~/.claude`, tabella dei task in `~/.config/ponytail/band/`); il webhook è vuoto di default e va lasciato così.
