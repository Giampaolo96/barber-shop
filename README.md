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
