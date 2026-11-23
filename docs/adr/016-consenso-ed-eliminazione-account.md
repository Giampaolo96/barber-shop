# ADR 016 – Nuovo consenso all'informativa ed eliminazione dell'account del cliente

## Contesto
SPEC §8 e fetta 9b. Il consenso privacy vale per la versione corrente dell'informativa (`shop_settings.privacy_policy_version`), ma fino alla 9b la versione non si poteva cambiare: un cambio avrebbe bloccato tutti i clienti senza modo di riaccettarla (ADR 002, ADR 005). Il cliente deve poter eliminare l'account; le prenotazioni passate restano per le statistiche, senza dati personali.

## Decisione
**Nuovo consenso**
- `profiles_guard_consents` ammette un solo cambio del consenso già dato: da una versione non più corrente alla versione corrente, con la data rimessa dal database. Ogni altro cambio resta vietato.
- Campo calcolato PostgREST `privacy_consent_outdated(profiles)`, letto nella stessa select del profilo di accesso (proxy e `current-user`): nessuna richiesta in più.
- `profileComplete` non cambia: il consenso scaduto blocca solo `/prenota*` (redirect a `/profilo/consenso?next=…`, come per `/profilo/completa`) e le server action e la GET del flusso. `/prenotazioni`, `/profilo` ed eliminazione restano aperte. Nel database lo garantisce già `create_online_booking`.
- In Impostazioni la versione si cambia solo con la conferma dell'avviso (campo `confirmPrivacyVersionChange`), non vuota e diversa da quella attuale (`privacyVersionChangeSchema`).
- Storico `consent_events` (privacy, marketing on/off), scritto solo dal trigger `profiles_log_consents`, letto solo dall'interessato, cancellato a cascata con il profilo. Prova del consenso (GDPR art. 7) finché l'account esiste.
- Testo dell'informativa in `src/content/privacy-policy.tsx`, pagina pubblica `/privacy` con la versione corrente.

**Eliminazione**
1. Server action `deleteAccount`: `requireRole(['customer'])`, poi rpc `delete_own_account()` con la sessione del cliente (security definer, solo `auth.uid()`, solo ruolo `customer`).
2. `anonymize_customer_bookings` (nessun grant, nemmeno `service_role`): future `confirmed` → `cancelled_by_customer`; note dello staff eliminate; `notes`, `guest_name`, `guest_phone` azzerati; riga di `login_code_attempts` dell'email eliminata. Quella già iniziata resta `confirmed`, anonima.
3. `auth.admin.deleteUser` con la service role, solo lato server. La cascata `auth.users → profiles` ripassa dal trigger before delete (stessa anonimizzazione, così è coperta anche una prenotazione creata nel frattempo o un'eliminazione fatta da altri) e la FK `bookings.customer_id … on delete set null` stacca le prenotazioni: nessuna si cancella a cascata.
4. Logout, cookie usa e getta `account_deleted` (httpOnly, 60 s) e redirect a `/`. La home lo legge, mostra il messaggio e lo fa cancellare subito (`DELETE /auth/account-eliminato`): nessun parametro nell'URL, un link nudo non mostra nulla. Il route handler è pubblico, unica eccezione a `requireRole`: senza sessione non c'è un ruolo da controllare, e cancella solo quel cookie.

Se il passo 3 fallisce l'account resta intero (profilo e utente Auth), con le future già cancellate e le note già azzerate: log con id e codice, senza email; il cliente vede l'errore e riprova, i passi sono ripetibili. Non resta mai un utente Auth senza profilo (email orfana che non potrebbe più registrarsi). Scartata l'alternativa di eliminare `auth.users` dentro la funzione SQL (atomica, ma l'eliminazione dell'utente Auth deve passare dalla service role).

## Conseguenze
- Admin: calendario, dettaglio e "Da aggiornare" mostrano "Cliente eliminato"; l'elenco clienti parte dai profili, quindi il cliente eliminato non c'è. Nessun link a schede cliente inesistenti.
- Statistiche: i conteggi delle passate non cambiano; le future cancellate contano fra le cancellate dal cliente. Una prenotazione demo di un cliente eliminato perde la nota e non è più riconosciuta come demo (caso accettato).
- Un cliente bloccato che si elimina può registrarsi di nuovo senza blocco (scelta MVP; domanda per il titolare in SPEC §13.10).
- Gli account dello staff non si eliminano da qui (fetta 9c).
- Un'eliminazione che parte direttamente da `auth.users` (admin, fetta 9c) passa dal trigger, ma lì l'email non è più leggibile: la riga di `login_code_attempts` resta. Da risolvere nella 9c leggendo l'email prima dell'eliminazione.
