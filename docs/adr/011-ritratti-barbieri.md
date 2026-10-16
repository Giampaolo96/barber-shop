# ADR 011 – Ritratti dei barbieri

Data: 2026-10-16 · Stato: accettata · Fetta 8d · Supera la decisione della fetta 3 "foto solo URL `https://`"

## Contesto

Dalla fetta 3 la foto di un barbiere era un URL `https://` esterno (`barbers.photo_url`) scritto a mano dall'admin e mostrato con un `<img>` normale. Per la demo e poi per le foto vere serve che l'admin carichi l'immagine dall'app, anche dal telefono. Andavano decisi:
- dove salvare il file e chi può scriverlo;
- come impedire che nel DB finisca un percorso arbitrario o un file che non è un'immagine;
- formato e dimensioni, tenendo conto che Safari iOS non produce WebP con `canvas.toBlob`;
- come mostrarlo senza aprire l'ottimizzazione di Next a host esterni.

## Decisione

**Dati** (migrazione `20261016090000_barber_photos`)
- `barbers.photo_url` eliminata; al suo posto `barbers.photo_path text`, con il vincolo `barbers_photo_path_format`: `null` oppure `<id della riga>/<32 esadecimali minuscoli>.webp`. Il prefisso è legato all'`id`, quindi non si può puntare al file di un altro barbiere né fuori dalla sua cartella.
- Grant di select di colonna su `photo_path` ad `anon` e `authenticated` (ADR 001); l'update resta all'admin tramite `barbers_admin_write`.
- Bucket `barber-photos`: pubblico in lettura (URL pubblico), limite 1 MB, solo `image/webp`. Policy su `storage.objects` per select, insert, update e delete solo per `is_admin()` e solo su questo bucket. Nessun `alter table` sulle tabelle di `storage`, che sono di proprietà di Supabase.

**Caricamento** (Admin → Barbieri → scheda)
- Nel browser: l'immagine si decodifica con un `<img>` (se non si decodifica, per esempio HEIC su Chrome desktop, compare "non è un'immagine leggibile" e non si invia nulla; se fallisce la codifica, per esempio per memoria su iOS, un messaggio distinto), si ritaglia al centro in un canvas 512×512 e si codifica in WebP 0,85. Se il blob non è WebP (Safari iOS restituisce PNG) si rifà in JPEG 0,85. La scelta del formato è la funzione pura `encodePortrait`.
- Sul server (`uploadBarberPhoto`): `requireRole('admin')`, Zod (tipo dichiarato `image/webp` o `image/jpeg`, poi peso ≤ 1 MB), controllo che il barbiere esista, poi i primi byte e il formato letto da `sharp` devono essere JPEG o WebP (SVG, PNG o testo rinominati vengono rifiutati) e `sharp` ricodifica sempre in WebP 512×512 senza metadati. `sharp` rifiuta immagini oltre 4096×4096 pixel (`limitInputPixels`): un file piccolo che dichiara dimensioni enormi non esaurisce la memoria della funzione. Nel bucket finisce solo WebP.
- Il percorso lo genera il server, nuovo a ogni caricamento: la CDN non serve mai la foto vecchia. Ordine: upload → update di `photo_path` → cancellazione del file precedente. Se l'update fallisce si cancella il file appena caricato.
- Tutto con il client dell'utente: la RLS del bucket vale anche qui, la `service_role` non si usa.
- `experimental.serverActions.bodySizeLimit` a 2 MB: con il limite predefinito di 1 MB Next rifiuterebbe un file vicino al limite prima che l'azione possa rispondere.

**Rimozione ed eliminazione**
- "Rimuovi": prima `photo_path = null`, poi il file, così il DB non punta mai a un file assente. Senza foto non fa nulla.
- Prima di ogni cancellazione si ricontrolla che il percorso sia nella cartella del barbiere (`isBarberPhotoPath`).
- L'eliminazione di un barbiere (possibile solo senza prenotazioni) cancella anche il suo file; la disattivazione lo lascia. Un errore nel cancellare il file dopo l'aggiornamento del DB lascia un file orfano ma non fa fallire l'azione.

**Visualizzazione**
- Componente `BarberPortrait`: `<img>` 512×512 con `loading="lazy"`, `decoding="async"`, alt "Ritratto di <nome>", quadrato e in scala di grigi (tema Mosca); senza foto l'iniziale in un riquadro tratteggiato. Nessuna ottimizzazione di Next e nessun `remotePatterns`: il file è già della dimensione giusta.

## Conseguenze

- Le foto non dipendono più da host esterni e il formato è sempre lo stesso.
- Un file orfano nel bucket è possibile solo se la cancellazione fallisce dopo l'aggiornamento della riga; si può ripulire a mano confrontando il bucket con `barbers.photo_path`.
- Limiti noti:
  - due caricamenti contemporanei per lo stesso barbiere leggono lo stesso percorso precedente: vince l'ultimo aggiornamento e il file dell'altro resta orfano nel bucket. È un'azione solo admin e rara; si potrebbe evitare con un update condizionato sul percorso precedente;
  - senza `NEXT_PUBLIC_SUPABASE_URL`, `barberPhotoUrl` produce un URL relativo che dà 404 senza avvisi. È un errore di configurazione che rompe comunque tutta l'app (client Supabase), quindi non ha un controllo dedicato.
- Le illustrazioni della demo si caricano dall'admin come le foto vere: nel codice non ci sono immagini legate ai nomi.
- In produzione il bucket e le policy arrivano con la migrazione; nessuna configurazione a mano su Supabase.
