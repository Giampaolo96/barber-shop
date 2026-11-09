-- Fetta 8h (audit 2026-10-30, punto 2; ADR 015): i privilegi staff valgono solo se il token dice
-- che l'accesso è avvenuto con password. Una sessione aperta con il codice email o con il recupero
-- password chiamando direttamente Supabase resta un utente senza privilegi. Il claim amr si
-- conserva al refresh del token (verificato in locale), quindi lo staff non perde la sessione.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb) @> '[{"method":"password"}]'::jsonb
     and exists (
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
  select coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb) @> '[{"method":"password"}]'::jsonb
     and exists (
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
     and coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb) @> '[{"method":"password"}]'::jsonb
$$;

revoke all on function public.is_admin(), public.is_staff(), public.current_barber_id()
  from public, anon, authenticated;
grant execute on function public.is_admin(), public.is_staff(), public.current_barber_id()
  to anon, authenticated;
