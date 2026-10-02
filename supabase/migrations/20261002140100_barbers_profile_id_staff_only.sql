-- barbers.profile_id è leggibile solo dallo staff. Clienti e staff condividono il ruolo
-- Postgres authenticated, quindi la colonna esce dai grant di lettura per tutti e lo
-- staff la legge tramite una funzione security definer.
revoke select on public.barbers from authenticated;
grant select (id, display_name, photo_url, bio, is_active) on public.barbers to authenticated;

-- Collegamento barbiere → account staff. Per chi non è staff restituisce zero righe.
create function public.barber_accounts()
returns table (barber_id uuid, profile_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.profile_id
    from public.barbers b
   where (select public.is_staff())
$$;

revoke all on function public.barber_accounts() from public, anon, authenticated;
grant execute on function public.barber_accounts() to authenticated;
