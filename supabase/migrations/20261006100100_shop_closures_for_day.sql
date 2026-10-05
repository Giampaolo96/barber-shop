-- Review fetta 8a (miglioria 7): il calcolo del giorno locale di shop_closures_today passa in una
-- funzione interna con l'istante come parametro, così i giorni del cambio d'ora (23 e 25 ore) si
-- possono verificare nei test. shop_closures_today resta identica per chi la chiama.

-- Chiusure che toccano il giorno locale (timezone del negozio) a cui appartiene p_at, intervalli
-- [inizio, fine). Interna: nessun ruolo dell'app la esegue direttamente.
create function public.shop_closures_on_local_day(p_at timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with day as (
    select (date_trunc('day', p_at at time zone s.timezone)) at time zone s.timezone as day_start,
           (date_trunc('day', p_at at time zone s.timezone) + interval '1 day') at time zone s.timezone as day_end
      from public.shop_settings s
     limit 1
  )
  select c.starts_at, c.ends_at
    from public.shop_closures c
    cross join day
   where c.starts_at < day.day_end
     and c.ends_at > day.day_start
   order by c.starts_at
$$;

revoke all on function public.shop_closures_on_local_day(timestamptz) from public, anon, authenticated;

create or replace function public.shop_closures_today()
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.starts_at, d.ends_at from public.shop_closures_on_local_day(now()) d
$$;

revoke all on function public.shop_closures_today() from public, anon, authenticated;
grant execute on function public.shop_closures_today() to anon, authenticated;
