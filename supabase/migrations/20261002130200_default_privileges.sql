-- Privilegi chiusi di default (review fetta 1): tabelle e funzioni nuove dello schema
-- public non ricevono più i grant automatici di Supabase per anon e authenticated.
alter default privileges in schema public revoke all on tables from anon, authenticated, public;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- ATTENZIONE: per le funzioni resta il default globale di Postgres (EXECUTE a PUBLIC), che
-- un revoke per schema non tocca. Ogni migrazione che crea una funzione deve quindi fare
-- un revoke esplicito da public, anon e authenticated e poi concedere solo i grant voluti.
-- Lo verifica il test pgTAP "nessuna funzione di public eseguibile da PUBLIC o anon".

-- Funzioni create dalle migrazioni precedenti: via i privilegi impliciti, poi solo grant
-- espliciti.
revoke all on function
  public.current_user_role(),
  public.is_admin(),
  public.is_staff(),
  public.current_barber_id(),
  public.search_customers(text),
  public.handle_new_user(),
  public.profiles_guard_reserved_columns(),
  public.bookings_require_customer_or_guest(),
  public.bookings_before_write(),
  public.bookings_sync_no_show_count()
from public, anon, authenticated;

-- search_customers controlla is_staff(), quindi non serve a service_role.
revoke all on function public.search_customers(text) from service_role;

-- Helper usati dalle policy: servono anche ad anon, che legge il catalogo.
grant execute on function
  public.current_user_role(),
  public.is_admin(),
  public.is_staff(),
  public.current_barber_id()
to anon, authenticated;

grant execute on function public.search_customers(text) to authenticated;

-- I costruttori del tipo range public.timerange (timerange, timemultirange) restano
-- eseguibili da tutti: Postgres li crea insieme al tipo come funzioni di sistema, di
-- proprietà del superutente, e una migrazione non può revocarne i privilegi. Costruiscono
-- solo un valore range a partire dagli argomenti, senza leggere dati.
