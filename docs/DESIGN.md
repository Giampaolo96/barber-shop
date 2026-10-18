# Design system

Come è fatta l'interfaccia e come si cambia tema. Il primo tema è **Mosca** (Mosca Barber Shop); un altro negozio richiede solo un nuovo tema, non modifiche alle pagine.

## Principi

- **Bianco e nero, nessun colore d'accento.** Il contrasto lo danno i pieni neri su bianco.
- **Il pieno nero indica ciò che è tuo o scelto**: la prossima prenotazione, il giorno selezionato, l'azione principale ("Conferma prenotazione"), la vista attiva del calendario.
- **Il bordo nero indica ciò che si può toccare**: scelte, orari, "Prenota", "Chiama". Le linee `--line` dividono soltanto, non si toccano.
- **Numeri come tipografia**: date e orari grandi in Bodoni sono l'elemento visivo della scelta, non etichette.
- **Un solo momento memorabile per schermata.** In home è la testata in marmo con la mosca (il biglietto della prossima prenotazione è il secondo elemento forte, mai un terzo); dopo la prenotazione è la schermata di conferma in marmo; tutto il resto è disciplinato.
- **Doppio filetto** (`border-double`, 3 px, colore `--ink`) solo come separatore principale: sotto i titoli di sezione della home, sopra e sotto il listino, sul pulsante "Prenota". Altrove bastano i bordi da 1 px.
- **Allineamento a sinistra**, griglia a 16 px su mobile, colonna di lettura `max-w-xl`.
- Mobile first per il cliente (tap target ≥ 44 px), desktop first per lo staff.

## Token

I nomi semantici sono in `src/styles/tokens.css`, che li mappa su shadcn (`--background`, `--primary`…) e su Tailwind (`bg-ink`, `text-muted-foreground`, `border-line`…). I valori stanno nel tema.

| Token | Uso | Mosca |
|---|---|---|
| `--surface` | fondo | `#FFFFFF` |
| `--ink` | testo, bordi interattivi, pieni | `#000000` |
| `--surface-marble` | solo la testata in marmo | `#171717` |
| `--marble-vein` | venature e scia sul marmo | `#FFFFFF` |
| `--ink-on-marble` | testo e mosca sul marmo | `#FFFFFF` |
| `--ink-muted` | testo secondario (6,7:1 sul bianco) | `#5C5C5C` |
| `--line` | divisori | `#DADADA` |
| `--surface-disabled` / `--ink-disabled` | disabilitato, giorni non lavorativi | `#F2F2F2` / `#8F8F8F` |
| `--danger` | solo errori e azioni distruttive | `#A4161A` |
| `--radius` | angoli | `0` |
| `--theme-font-display` | titoli, nome del negozio, date e orari grandi | Bodoni Moda |
| `--theme-font-body` | tutto il resto; cifre tabellari negli orari | Hanken Grotesk |

Regole:
- Nessun colore letterale fuori da `src/themes/` (lo verifica `tests/acceptance/theme.test.ts`); nei componenti si usano solo le classi dei token.
- Gli errori sono riconoscibili anche senza colore: testo esplicito e filetto a sinistra (`border-l-2 border-destructive`).
- Il disabilitato usa i suoi colori, non l'opacità.
- Focus unico per ogni elemento interattivo: contorno pieno di 2px staccato di 2px (`:focus-visible` in `globals.css`, colore `--ring`). Sui fondi scuri (blocco nero, marmo) si aggiunge la classe `on-ink`, che rende il contorno chiaro.
- Un'informazione data solo dall'aspetto (es. giorno tratteggiato = senza orari) ha anche un testo per gli screen reader.
- Le foto dei barbieri sono quadrate e in scala di grigi, coerenti con il bianco e nero.
- I campi nativi (`select`, `textarea`) usano `selectClass` e `textareaClass` di `src/components/ui/field.ts`, allineati a `<Input>`.
- I font sono self-hosted con `next/font` (nessuna richiesta a Google a runtime) e si importano solo nel tema.

## Marmo e mosca (tema Mosca)

- **Marmo**: fondo `--surface-marble` con venature SVG (curve sottili, opacità 0,2–0,5, spessori diversi, `non-scaling-stroke`). **Solo nella testata della home e nella schermata di conferma** (a schermo intero), mai altrove.
- **Mosca**: icona a tratto (testa e corpo pieni, due ali ellittiche, zampette sottili), componente unico `Fly` con `data-testid="fly"`. Usi:
  - in home vola sopra il nome lungo una scia tratteggiata di un giro, che si disegna una volta al caricamento;
  - nella scelta dell'orario compare dentro lo slot toccato mentre si apre il riepilogo;
  - nella schermata di conferma atterra alla fine della scia e resta posata;
  - piccola e ferma (`EmptyMark`) accanto al titolo del listino e negli stati vuoti dell'area clienti.

## Movimento

- Solo CSS, tutto dentro `@media (prefers-reduced-motion: no-preference)`: con `reduce` ogni elemento è già nello stato finale.
- Ogni animazione parte una volta (caricamento o pressione) e finisce: niente `infinite`, niente loop.
- Usi ammessi: scia e volo della home, atterraggio della mosca sulla conferma, orari della griglia che compaiono in rapida sequenza (ritardo limitato), pulsanti e scelte che si invertono in nero alla pressione (`active:`).
- Stati vuoti: un testo e un invito all'azione; nell'area clienti anche la mosca piccola.
- Nell'area staff niente marmo né mosca.

## Cosa NON fare

- Niente gradienti decorativi. L'unico motivo a righe è il tratteggio informativo di assenze e chiusure nel calendario (`bg-hatch`).
- Niente ombre morbide, né sulle card né sui pulsanti.
- Niente maiuscoletto né tutto maiuscolo sulle etichette.
- Niente card tutte uguali con angoli arrotondati: angoli vivi, bordi da 1 px.
- Niente separatori "·" tra metadati, niente "→" aggiunte ai pulsanti.
- Niente colori della palette Tailwind (`emerald-*`, `amber-*`…) né opacità per il testo secondario: si usano i token.
- Il nome del negozio non si scrive nel codice: viene da `shop_settings` (in testata la prima parola in grande, il resto sotto, `splitShopName`).

## Struttura e nuovo tema

```
src/styles/tokens.css        nomi semantici e mappa verso shadcn/Tailwind (nessun valore)
src/themes/active.ts         unico punto in cui si sceglie il tema
src/themes/mosca/
  theme.css                  valori dei token e animazioni del tema
  fonts.ts                   next/font: Bodoni Moda e Hanken Grotesk
  marble.tsx, fly.tsx        segni grafici del tema
  identity.ts, app-icon.ts   colori e icona dell'app installata (ADR 009)
  index.ts                   export comuni a ogni tema
```

Ogni tema esporta gli stessi nomi: `fontVariables`, `HeroBackground` (fondo della testata), `HeroMark` (segno sopra il nome), `PendingMark` (segno nello slot in caricamento), `EmptyMark` (segno piccolo degli stati vuoti e del listino), `ConfirmationBackground` e `ConfirmationMark` (fondo e segno della schermata di conferma), `appIdentity` (colori dell'app installata), `calendarUidHost` (parte fissa dell'UID degli eventi `.ics`, solo lato server) e `appIconSvg` (disegno dell'icona dell'app, usato solo lato server). Per un nuovo negozio:
1. creare `src/themes/<nome>/` con gli stessi file ed export;
2. in `src/themes/active.ts` sostituire `mosca` con il nome del nuovo tema (import del CSS, `themeName` usato dalla pagina offline, export);
3. impostare nome e recapiti in Impostazioni.
