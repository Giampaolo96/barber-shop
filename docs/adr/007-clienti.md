# ADR 007 – Sezione Clienti: elenco, storico, blocco e azzeramento dei no-show

Data: 2026-10-05 · Stato: accettata · Fetta 6b

## Contesto

SPEC §6.7 chiede per l'admin elenco dei clienti con ricerca, storico, contatore no-show e blocco/sblocco. Restavano aperti alcuni punti:
- il blocco automatico per no-show (fetta 5) dipende solo da `no_show_count`, che segue le prenotazioni: l'admin non aveva modo di toglierlo senza riscrivere lo stato delle no-show;
- l'email del cliente sta in `auth.users`, non in `profiles`: senza email un cliente con il profilo incompleto (né nome né telefono) non si trova;
- nella prenotazione manuale lo staff non vedeva se un cliente era bloccato.

## Decisione

**Azzeramento dei no-show**
- Nuove colonne `profiles.no_show_reset_at` e `profiles.no_show_reset_by` (`on delete set null`), senza grant di update: le scrive solo `reset_no_show_count`.
- `no_show_count` diventa "no-show dall'ultimo azzeramento": il trigger `bookings_sync_no_show_count` conta una prenotazione `no_show` intestata al cliente solo se `starts_at >= no_show_reset_at` (o se non c'è stato azzeramento). Ora scatta anche al cambio di `starts_at`.
- Il perdono copre il passato, per scelta: una no-show segnata dopo l'azzeramento su una prenotazione iniziata prima non conta, e riportare a un altro stato o eliminare una vecchia no-show non decrementa.
- Cambiando `customer_id` di una no-show, conta per il nuovo cliente secondo il suo azzeramento e scende per il vecchio solo se per lui contava.
- `reset_no_show_count(p_customer_id)`: `security definer`, verifica `is_admin()` al proprio interno (un admin bloccato non la usa, `42501`), solo profili `customer` (altrimenti `P0002`). Imposta contatore 0, `no_show_reset_at = now()`, `no_show_reset_by = auth.uid()`. Si può ripetere.
- `create_online_booking`, `online_slot_error` e `isBlockedForBooking` non cambiano: leggono il contatore come prima.

**Blocco manuale**
- "Blocca/Sblocca" agisce solo su `is_blocked`, con l'update filtrato su `role = 'customer'`: lo staff si blocca dalla scheda barbiere (ADR 003), dove si revocano anche le sessioni.
- Bloccare non cancella prenotazioni e non chiude la sessione: impedisce solo la prenotazione online. Lo staff può ancora creare manuali per il cliente.
- Stato mostrato: attivo, bloccato dall'admin, bloccato per no-show (N su soglia), o entrambe le etichette.

**Letture**
- `admin_customers(q, p_limit, p_offset)` e `admin_customer(p_id)`: `security definer`, verificano `is_admin()` al proprio interno, solo profili `customer`, email da `auth.users`.
  - Ricerca: `q` (troncato a 100) con meno di 2 caratteri non filtra; `ilike` su nome ed email con escape di `%`, `_`, `\`; sul telefono le sole cifre, se almeno 3.
  - Ordine per nome (senza nome in fondo), 25 per pagina (`p_limit` 1–100, `p_offset` negativo = 0), `total_count` prima della paginazione.
- Storico dalla RLS di `bookings` (l'admin vede tutto), prima le più recenti, al massimo 100 righe con avviso.
- `/admin/clienti` e `/admin/clienti/[id]` sono solo admin (`requireRole(["admin"])`, voce di menu `adminOnly`).

**Etichetta "Bloccato" nella manuale**
- `blocked_customer_ids(p_ids)`: `security definer`, solo staff non bloccato, restituisce gli id dell'input che sono clienti bloccati per la prenotazione online (stessa regola di `create_online_booking`). `search_customers` resta invariata.
- Il barbiere vede quindi il blocco anche di clienti che non ha mai servito: è un'informazione che gli serve per fissare l'appuntamento.
- Se la funzione fallisce, la ricerca mostra comunque i risultati con l'avviso "Impossibile verificare i blocchi dei clienti" e stato sconosciuto (`blocked: null`), mai "non bloccato"; l'errore va nel log.

## Conseguenze

- Il totale storico dei no-show non è più un campo: si legge dallo storico delle prenotazioni.
- Gli errori del database nelle azioni: `42501` → "Operazione non consentita", il resto (es. `P0002`) → errore generico.
- Un'assenza di `shop_settings` in `blocked_customer_ids` vale come soglia 0 (solo blocco manuale).
