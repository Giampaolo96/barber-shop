# ADR 010 – Statistiche dell'admin

Data: 2026-10-11 · Stato: accettata · Fetta 9a

## Contesto

SPEC §6.9 chiede prenotazioni e incasso stimato per giorno, settimana e mese, per barbiere e per servizio, e il tasso di no-show. Andavano decisi:
- che cosa conta come prenotazione e come incasso;
- a quale giorno si attribuisce una prenotazione;
- dove fare i conti, dato che un mese di un negozio con tre barbieri supera le 1000 righe che PostgREST restituisce al massimo;
- come trattare le prenotazioni demo, che in produzione servono per mostrare l'app e devono comparire normalmente.

## Decisione

**Definizioni** (SPEC §6.9)
- Prenotazioni: stati `confirmed`, `completed` e `no_show`. Cancellazioni a parte, divise fra cliente e negozio.
- Incasso stimato: somma di `price_cents` (il prezzo copiato sulla prenotazione, CLAUDE.md regola 4) delle `completed` e `confirmed`.
- Tasso di no-show: `no_show` diviso le prenotazioni non cancellate già iniziate; "—" se nessuna. Percentuale intera.
- Passate da chiudere: prenotazioni già iniziate ancora `confirmed`.
- Ogni prenotazione conta nel giorno locale di `starts_at` (timezone del negozio), non in quello di creazione. Settimane da lunedì; i bucket ai bordi del periodo si tagliano.

**Database**: `admin_booking_stats(p_from, p_to, p_exclude_demo)` (migrazione `20261011090000`)
- `security definer`, verifica `is_admin()` al proprio interno (`42501`, prima di ogni altro controllo); periodo valido solo se `p_from <= p_to` e al massimo 366 giorni (`22023`).
- Restituisce un `jsonb` con i gruppi per giorno locale, barbiere, servizio, stato e "già iniziata" (`starts_at <= now()`), con numero di prenotazioni e somma di `price_cents`. Il `jsonb` evita il limite di righe di PostgREST; i gruppi sono al massimo giorni × barbieri × servizi × stati × 2.
- Execute solo ad `authenticated`, revocato anche alla `service_role` (come le funzioni dei clienti, ADR 007).
- Nuovo indice `bookings_starts_at_idx`: la ricerca per periodo riguarda tutti i barbieri, e `(barber_id, starts_at)` non basta. Le somme degli importi sono `bigint`.
- Demo: con `p_exclude_demo` si escludono le prenotazioni la cui nota del cliente (`bookings.notes`), senza spazi, tab e a capo ai bordi e senza distinguere maiuscole e minuscole, è "Prenotazione demo". La nota interna dello staff non conta. Di base le demo sono incluse.

**Logica pura** in `src/lib/stats/` (CLAUDE.md regola 5)
- `buildStats` applica le definizioni ai gruppi: totali, andamento con tutti i bucket (anche vuoti), righe per barbiere e per servizio, filtro per barbiere.
- Nelle righe compaiono anche barbieri e servizi attivi senza prenotazioni nel periodo, a zero; i disattivati solo se hanno prenotazioni nel periodo. Ordine: prenotazioni, poi incasso decrescenti, poi id.
- Lo schema dei parametri della pagina non fallisce mai: un periodo non valido torna al mese corrente, gli altri valori ai predefiniti.
- La lettura dal database sta in `src/lib/db/stats.ts`.

**Pagina** `/admin/statistiche`, solo admin (il barbiere non vede neppure le proprie)
- Modulo GET con periodo, scorciatoie (settimana, mese, ultimi 3 mesi di calendario, anno), raggruppamento, barbiere e casella demo; riquadri dei totali; grafico a barre dell'andamento (prenotazioni o incasso) in HTML e CSS con i token del tema, nascosto agli screen reader; tabella dell'andamento sotto come versione accessibile; tabelle per barbiere e per servizio.

## Conseguenze

- Le formule si cambiano in un solo punto, testato con Vitest; il database fa solo il raggruppamento per giorno locale.
- L'incasso stimato include le `confirmed` non ancora segnate: se lo staff non chiude le prenotazioni, il riquadro "Passate da chiudere" lo mostra.
- Le prenotazioni anonimizzate dall'eliminazione dell'account (fetta 9b) restano nelle statistiche: non servono i dati del cliente.
- Una prenotazione demo con una nota diversa dal testo esatto conta sempre; il filtro è facoltativo e non tocca i dati.
