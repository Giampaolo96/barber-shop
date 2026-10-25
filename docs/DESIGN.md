# Design system

Come è fatta l'interfaccia e come si cambia tema. Il primo tema è **Mosca** (Mosca Barber Shop); un altro negozio richiede solo un nuovo tema, non modifiche alle pagine. **Mosca neon** è la variante scura dello stesso negozio (vedi "Luce e vetro"): estende Mosca e si attiva con una riga in `src/themes/active.ts`.

I principi qui sotto sono scritti per Mosca (nero su bianco); in Mosca neon i ruoli restano gli stessi con i colori rovesciati: il "pieno nero" diventa un pieno bianco acceso, il "bordo nero" un bordo bianco.

## Principi

- **Bianco e nero, nessun colore d'accento.** Il contrasto lo danno i pieni neri su bianco.
- **Il pieno nero indica ciò che è tuo o scelto**: la prossima prenotazione, il giorno selezionato, l'azione principale ("Conferma prenotazione"), la vista attiva del calendario.
- **Il bordo nero indica ciò che si può toccare**: scelte, orari, "Prenota", "Chiama". Le linee `--line` dividono soltanto, non si toccano.
- **Numeri come tipografia**: date e orari grandi in Bodoni sono l'elemento visivo della scelta, non etichette.
- **Un solo momento memorabile per schermata.** In home è la testata in marmo con la mosca (il biglietto della prossima prenotazione è il secondo elemento forte, mai un terzo); dopo la prenotazione è la schermata di conferma in marmo; tutto il resto è disciplinato.
- **Doppio filetto** (`border-double`, 3 px, colore `--ink`) solo come separatore principale: sotto i titoli di sezione della home, sopra e sotto il listino, sul pulsante "Prenota". Altrove bastano i bordi da 1 px.
- **Allineamento a sinistra**, griglia a 16 px su mobile, colonna di lettura `max-w-xl`. Eccezione: "Quando?" usa `max-w-3xl` (una fila continua di colonne, giorno × barbiere, ADR 013) e un'intestazione compatta (`StepHeader compact`, senza il segno del tema, su una riga sola con il sottotitolo troncato). Nelle colonne di "Quando?" la testata (data piccola, ritratto e nome) è centrata, l'unico testo non allineato a sinistra della schermata: con colonne strette fino a 5 rem il nome centrato sopra gli orari si legge meglio.
- Mobile first per il cliente (tap target ≥ 44 px), desktop first per lo staff.

## Token

I nomi semantici sono in `src/styles/tokens.css`, che li mappa su shadcn (`--background`, `--primary`…) e su Tailwind (`bg-ink`, `text-muted-foreground`, `border-line`…). I valori stanno nel tema.

| Token | Uso | Mosca | Mosca neon |
|---|---|---|---|
| `--surface` | fondo | `#FFFFFF` | `#0B0B0C` |
| `--ink` | testo, bordi interattivi, pieni | `#000000` | `#F2F5F8` (18:1) |
| `--surface-marble` | solo la testata in marmo | `#171717` | `#141517`, opacità 88% |
| `--marble-vein` | venature e scia sul marmo | `#FFFFFF` | `#FFFFFF` |
| `--ink-on-marble` | testo e mosca sul marmo | `#FFFFFF` | `#F2F5F8` |
| `--ink-muted` | testo secondario | `#5C5C5C` (6,7:1) | `#9BA3AD` (7,7:1; 7,2:1 sul marmo) |
| `--line` | divisori | `#DADADA` | `#2C3036` |
| `--surface-disabled` / `--ink-disabled` | disabilitato, giorni non lavorativi | `#F2F2F2` / `#8F8F8F` | `#17181B` / `#868D96` (5,3:1) |
| `--danger` | solo errori e azioni distruttive | `#A4161A` | `#F28B8B` (8,3:1) |
| `--scrim` | velo dietro i dialoghi | nero al 40% | nero al 65% |
| `--ring-on-ink` | focus sui fondi scuri (`.on-ink`) | `--surface` | `--ink` |
| `--ink-control-rest` | bordo a riposo degli orari e dei giorni non selezionati di "Quando?" (`border-control-rest`); bianco su passaggio, focus e pressione | `--ink` | `#9AA1AB` (6,9:1; al centro della luce più forte 4,9:1 sul fondo e 4,2:1 sulla casella) |
| `--radius` | angoli | `0` | `0` |
| `--radius-control` | caselle di orari e giorni di "Quando?" (`rounded-control`; anche "Giorno precedente/successivo") | `0` | `10px` |
| `--surface-control` | fondo a riposo degli orari di "Quando?" (`bg-surface-control`) | `--surface` | bianco al 5% (testo 9,9:1 nel caso peggiore) |
| `--control-gap` | spazio fra orari e fra colonne (`gap-control`) | `6px` | `10px` |
| `--day-gap` / `--day-divider` | spazio e linea fra due giorni della fila di "Quando?" (`ml-day`, `bg-day-divider`) | `16px` / `--line` | `24px` / `--line` |
| `--theme-font-display` | titoli, nome del negozio, date e orari grandi | Bodoni Moda | Bodoni Moda |
| `--theme-font-body` | tutto il resto; cifre tabellari negli orari | Hanken Grotesk | Hanken Grotesk |

Ogni tema dichiara anche `color-scheme` (controlli nativi chiari o scuri) e i token di "Luce e vetro", che in Mosca valgono `none`/`0`.

Regole:
- Nessun colore letterale fuori da `src/themes/` (lo verifica `tests/acceptance/theme.test.ts`); nei componenti si usano solo le classi dei token.
- Gli errori sono riconoscibili anche senza colore: testo esplicito e filetto a sinistra (`border-l-2 border-destructive`).
- Il disabilitato usa i suoi colori, non l'opacità.
- Focus unico per ogni elemento interattivo: contorno pieno di 2px staccato di 2px (`:focus-visible` in `globals.css`, colore `--ring`), più il bagliore `--glow-focus` del tema. Sui fondi scuri (blocco nero, marmo, vetro) si aggiunge la classe `on-ink`, che rende il contorno chiaro (`--ring-on-ink`).
- Un'informazione data solo dall'aspetto (es. giorno tratteggiato = senza orari) ha anche un testo per gli screen reader.
- Le foto dei barbieri sono quadrate e in scala di grigi, coerenti con il bianco e nero; cornice e filtro vengono dal tema (classe `portrait`). Le foto non si invertono mai.
- I campi nativi (`select`, `textarea`) usano `selectClass` e `textareaClass` di `src/components/ui/field.ts`, allineati a `<Input>`.
- I font sono self-hosted con `next/font` (nessuna richiesta a Google a runtime) e si importano solo nel tema.

## Marmo e mosca (tema Mosca)

- **Marmo**: fondo `--surface-marble` con venature SVG (curve sottili, opacità 0,2–0,5, spessori diversi, `non-scaling-stroke`). **Solo nella testata della home e nella schermata di conferma** (a schermo intero), mai altrove.
- **Mosca**: icona a tratto (testa e corpo pieni, due ali ellittiche, zampette sottili), componente unico `Fly` con `data-testid="fly"`. Usi:
  - in home vola sopra il nome lungo una scia tratteggiata di un giro, che si disegna una volta al caricamento;
  - nella scelta dell'orario compare dentro lo slot toccato mentre si apre il riepilogo;
  - nella schermata di conferma atterra alla fine della scia e resta posata;
  - piccola e ferma (`EmptyMark`) accanto al titolo del listino e negli stati vuoti dell'area clienti.

## Luce e vetro (tema Mosca neon)

Il nero profondo richiama il negozio di sera: neon bianchi (al massimo con una leggera sfumatura fredda, mai colori accesi), poche luci sfocate sullo sfondo, vetro scuro su pochi pannelli. Le classi stanno in `src/styles/tokens.css` e si usano in ogni tema; i valori stanno nel tema (`src/themes/mosca-neon/theme.css`). In Mosca valgono `none`/`0` e le classi non cambiano nulla.

| Classe | Dove | Token |
|---|---|---|
| `text-glow` | titoli, nome del negozio, date e orari grandi; **mai sul testo lungo** | `--glow-text` |
| `glow` | azione principale (pulsante pieno, "Prenota", "Aggiungi al calendario"); il bagliore cresce al passaggio e al focus | `--glow-box`, `--glow-primary-hover` |
| `glow-hover` | pulsanti con bordo, orari, giorni, righe del listino: si illuminano al passaggio e al focus | `--glow-box-hover` |
| `[aria-current]` | elemento selezionato (giorno, vista del calendario, barbiere della settimana): si accende senza classi | `--glow-box` |
| `glass` | **solo** pannelli grandi: riepilogo e dettagli della conferma | `--glass-bg`, `--glass-border`, `--glass-filter`, `--glass-pad` |
| `glass-ink` | biglietto della prossima prenotazione (blocco nero in Mosca, vetro nel neon) | `--glass-ink-*` |
| `sticky-bar` | striscia dei giorni, unico elemento fisso: fondo pieno in Mosca; nel neon velato e sfocato solo sugli schermi bassi (dove la pagina scorre), trasparente su quelli alti | `--sticky-bar-bg`, `--sticky-bar-filter` |
| `portrait` | ritratti dei barbieri | `--portrait-*` |
| `mark-glow` | la mosca in volo e posata | `--glow-mark` |

- **Neon a due livelli**: alone stretto e intenso (`--neon-core`, `--neon-tight`) più alone largo e morbido (`--neon-halo`, `--neon-wide`, `--neon-wide-hover`). Per più o meno effetto si regolano questi token; i bagliori `--glow-*` li compongono.
- **Bianco pieno solo per ciò che è scelto o decisivo**: il giorno selezionato e "Conferma prenotazione". Gli orari e i giorni non selezionati hanno a riposo un bordo grigio freddo e si accendono di bianco con il bagliore al passaggio, al focus e alla pressione.
- **Vetro mai sugli elementi ripetuti** (orari di "Quando?", righe delle liste, schede del calendario): lì bordo e glow semplici. `backdrop-filter` costa sugli smartphone e nelle colonne che scorrono.
- **Luci d'ambiente** (`AmbientBackground`, solo area clienti): tre macchie bianche già sfocate (gradienti radiali, mai `filter: blur`) su un livello fisso dietro le pagine. All'apertura una sola deriva lenta (`--ambient-drift`, 30 s, solo `transform` e `opacity`), poi restano ferme; la deriva si sospende quando la pagina non è visibile. Token: `--ambient-color`, `--ambient-opacity`, `--ambient-size`.
- **Marmo** in testata e sulla conferma come in Mosca, con venature a bassa opacità (`--marble-vein-opacity`) e fondo un po' trasparente, così le luci ci passano sotto.
- **Ritratti a "lightbox"**: immagine attenuata in scala di grigi, cornice nera interna di 2 px, bordo neon con alone. Mai inversione: le foto vere restano foto.
- **Accensione del pulsante di conferma** (`neon-ignite`): alla comparsa due lampi in meno di un secondo, poi luce stabile; mai in loop (`--ignite-duration`, `--ignite-delay`).
- **Ingresso delle pagine** (`page-in` in `src/app/(customer)/template.tsx`): dissolvenza di sola opacità (`--page-fade`).
- **Area staff sobria** (`data-area="admin"` sui layout di `/admin`): stessa palette, niente luci d'ambiente, marmo, mosca o flicker, niente bagliore sul testo né al passaggio; glow solo su azione principale, focus ed elemento selezionato. Gli stati del calendario restano distinti dal bordo (pieno, `--line`, `--danger`, tratteggiato e barrato).
- **PWA**: `appIdentity` (theme-color, manifest, pagina offline) e `appAppearance` (`color-scheme`, barra di stato iOS `black`) vengono dal tema.

## Movimento

- Solo CSS, tutto dentro `@media (prefers-reduced-motion: no-preference)`: con `reduce` ogni elemento è già nello stato finale (nel tema neon resta solo il bagliore fermo: niente deriva, accensione né dissolvenza).
- Ogni animazione parte una volta (caricamento o pressione) e finisce: niente `infinite`, niente loop.
- Usi ammessi: scia e volo della home, atterraggio della mosca sulla conferma, orari della griglia che compaiono in rapida sequenza (ritardo limitato), pulsanti e scelte che si invertono in nero alla pressione (`active:`). Nel tema neon anche: deriva delle luci all'apertura, accensione del pulsante di conferma, dissolvenza d'ingresso delle pagine, bagliore che cresce al passaggio (transizione breve di `box-shadow`).
- Stati vuoti: un testo e un invito all'azione; nell'area clienti anche la mosca piccola.
- Riscontro al tocco: i link che aprono una pagina dell'area clienti (listino, "Quando?", riepilogo, Le mie prenotazioni) diventano pieni con il segno del tema mentre la pagina si apre (`LinkPending`, `src/components/link-pending.tsx`, lo stesso stato degli orari), sovrapposti al link: niente spostamenti; il segno si muove solo se il movimento è ammesso. Niente scheletri `loading.tsx`: React mostra il contenuto non prima di 300 ms dopo uno scheletro, più di quanto risponde il server (40–150 ms).
- Nell'area staff niente marmo né mosca.

## Cosa NON fare

- Niente gradienti decorativi. L'unico motivo a righe è il tratteggio informativo di assenze e chiusure nel calendario (`bg-hatch`). L'unica sfumatura ammessa è funzionale: in fondo a una colonna di "Quando?" che ha altri orari sotto (`from-surface`). Eccezione del tema neon: i gradienti radiali delle luci d'ambiente, solo nel loro livello.
- Niente ombre morbide, né sulle card né sui pulsanti. Eccezione: i bagliori del tema, solo attraverso le classi e i token di "Luce e vetro" (mai un'ombra scritta in un componente).
- Niente maiuscoletto né tutto maiuscolo sulle etichette.
- Niente card tutte uguali con angoli arrotondati: angoli vivi, bordi da 1 px. Unica eccezione, solo nel tema neon: le caselle di orari e giorni di "Quando?" (`--radius-control`); pannelli, biglietto, "Primo libero" e pulsanti grandi restano ad angoli vivi.
- Niente separatori "·" tra metadati, niente "→" aggiunte ai pulsanti.
- Niente colori della palette Tailwind (`emerald-*`, `amber-*`…) né opacità per il testo secondario: si usano i token.
- Il nome del negozio non si scrive nel codice: viene da `shop_settings` (in testata la prima parola in grande, il resto sotto, `splitShopName`).

## Struttura e nuovo tema

```
src/styles/tokens.css        nomi semantici e mappa verso shadcn/Tailwind (nessun valore)
src/themes/active.ts         unico punto in cui si sceglie il tema: una riga, export * from "./<tema>"
src/themes/mosca/
  theme.css                  valori dei token e animazioni del tema
  fonts.ts                   next/font: Bodoni Moda e Hanken Grotesk
  marble.tsx, fly.tsx        segni grafici del tema
  identity.ts, app-icon.ts   colori, aspetto e icona dell'app installata (ADR 009)
  index.ts                   importa theme.css; export comuni a ogni tema
src/themes/mosca-neon/       estende mosca
  theme.css                  tutti i valori del tema neon (palette, luce, vetro, luci, durate)
  ambient.tsx                luci d'ambiente
  fonts.ts, identity.ts      font (quelli di Mosca), colori e aspetto dell'app
  index.ts                   importa ../mosca/theme.css e poi ./theme.css; riusa i segni di Mosca
```

**Temi che ne estendono un altro.** Un tema non importa mai un altro tema, con un'unica eccezione dichiarata: `mosca-neon` → `mosca` (mai il contrario). La regola e l'elenco delle eccezioni sono in `tests/acceptance/theme.test.ts` (`THEME_EXTENDS`).

Ogni tema esporta gli stessi nomi: `themeName` (cartella del tema, letta dalla pagina offline), `fontVariables`, `HeroBackground` (fondo della testata), `HeroMark` (segno sopra il nome), `PendingMark` (segno nello slot in caricamento), `EmptyMark` (segno piccolo degli stati vuoti e del listino), `ConfirmationBackground` e `ConfirmationMark` (fondo e segno della schermata di conferma), `AmbientBackground` (luci d'ambiente dell'area clienti, `null` in Mosca), `appIdentity` (colori dell'app installata), `appAppearance` (`colorScheme` e barra di stato iOS), `calendarUidHost` (parte fissa dell'UID degli eventi `.ics`, solo lato server) e `appIconSvg` (disegno dell'icona dell'app, usato solo lato server). Per un nuovo negozio:
1. creare `src/themes/<nome>/` con gli stessi file ed export (l'`index.ts` importa il proprio `theme.css`, il cui `:root` contiene tutti i token, compresi quelli di "Luce e vetro");
2. in `src/themes/active.ts` cambiare l'unica riga: `export * from "./<nome>";`
3. impostare nome e recapiti in Impostazioni.
