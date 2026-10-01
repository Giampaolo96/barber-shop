---
name: slice
description: Sviluppa una fetta del piano (docs/SPEC.md §11) in sessione singola con test di accettazione scritti prima, implementazione incrementale e review finale. Uso - /slice <numero fetta>
---
# Sviluppo di una fetta

Fetta richiesta: $ARGUMENTS

## 0. Preparazione
- Leggi `CLAUDE.md`, `docs/SPEC.md` (§11 per la fetta e le sezioni funzionali collegate, §3.7, §12) e `docs/PROGRESS.md`.
- Se le fette precedenti non risultano completate in `docs/PROGRESS.md`, fermati e dillo.
- Annota l'hash di partenza con `git log -1 --format=%h`.

## 1. Piano (attendi approvazione)
Presenta all'utente:
- obiettivo e criterio di "fatto" della fetta;
- passi in ordine, con file coinvolti e migrazioni previste;
- test di accettazione che verranno scritti;
- punti ambigui della SPEC, con una proposta per ciascuno.
Non scrivere nulla finché l'utente non approva.

## 2. Test prima del codice
- Delega al subagent `spec-qa` la scrittura dei test di accettazione della fetta, passandogli il numero della fetta e le decisioni prese al punto 1.
- Mostra all'utente il riepilogo dei test e le interfacce attese. Attendi l'ok, poi committa con `test: acceptance fetta N`.
- Le fette 0 e 8 non hanno logica di dominio: qui bastano test di fumo (l'app parte, la build passa, il manifest PWA è valido).

## 3. Implementazione
- Procedi un passo alla volta secondo il piano. Dopo ogni passo esegui i test pertinenti.
- Non modificare i test di accettazione. Se ne ritieni uno sbagliato rispetto alla SPEC, fermati e chiedi all'utente.
- Dopo ogni migrazione: `npx supabase db reset` e rigenera i tipi.
- A fine implementazione devono passare `npm run lint`, `npm run typecheck`, `npm test` e, se la fetta ha flussi UI, `npm run test:e2e`.

## 4. Review
- Delega al subagent `reviewer` la revisione, passandogli l'hash di partenza.
- Correggi tutti i problemi BLOCCANTI e riesegui i controlli.
- Elenca all'utente le MIGLIORIE senza applicarle: decide lui.

## 5. Chiusura
- Riporta l'esito reale di lint, typecheck, test ed e2e.
- Aggiorna `docs/PROGRESS.md`: stato, data, cosa è stato fatto, decisioni prese, problemi aperti.
- Proponi il messaggio di commit (Conventional Commits). Non fare push.
- Riassunto finale: cosa funziona, test aggiunti, migliorie rimandate, domande aperte.

## Regole sempre valide
- Se la SPEC è ambigua, decide l'utente.
- Nessuna regola della SPEC si cambia senza l'ok dell'utente; se cambia, aggiorna anche `docs/SPEC.md`.
