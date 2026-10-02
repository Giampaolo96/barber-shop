-- Review fetta 2: lo staff bloccato perde i privilegi anche nel database, non solo
-- nell'app. Gli helper delle policy ignorano il ruolo staff di un profilo bloccato, che
-- per la RLS resta un utente senza privilegi (vede solo ciò che vede un cliente).
-- current_user_role() continua a restituire il ruolo scritto in profiles; il cliente
-- bloccato resta un cliente normale (il suo blocco riguarda la prenotazione, fetta 5).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.role = 'admin' and not p.is_blocked
  )
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.role in ('barber', 'admin') and not p.is_blocked
  )
$$;

create or replace function public.current_barber_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
    from public.barbers b
    join public.profiles p on p.id = b.profile_id
   where b.profile_id = (select auth.uid())
     and p.role in ('barber', 'admin')
     and not p.is_blocked
$$;

-- Helper delle policy: eseguibili da anon e authenticated come prima.
revoke all on function public.is_admin(), public.is_staff(), public.current_barber_id()
  from public, anon, authenticated;
grant execute on function public.is_admin(), public.is_staff(), public.current_barber_id()
  to anon, authenticated;
