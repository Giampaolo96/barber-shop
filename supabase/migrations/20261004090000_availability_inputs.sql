-- Input del motore di disponibilità (SPEC §4, fetta 4, ADR 004). Il calcolo degli slot è in
-- src/lib/availability/ (TypeScript puro); qui solo i dati minimi, leggibili anche senza login.

-- Fascia locale del negozio → intervallo concreto: l'ora legale la gestisce Postgres
-- (una fascia che attraversa le 02:00–03:00 dura un'ora in meno o in più).
create function public.local_band_to_interval(p_date date, p_start time, p_end time, p_tz text)
returns tstzrange
language sql
stable
set search_path = ''
as $$
  select tstzrange((p_date + p_start) at time zone p_tz, (p_date + p_end) at time zone p_tz, '[)')
$$;

revoke all on function public.local_band_to_interval(date, time, time, text)
  from public, anon, authenticated;

-- Tipo degli intervalli restituiti da availability_inputs.
create type public.availability_kind as enum ('work', 'time_off', 'closure', 'busy');

-- Fasce di lavoro, assenze, chiusure e prenotazioni confirmed come semplici intervalli: nessun
-- dato di clienti, servizi, stati o id di prenotazione (CLAUDE.md, regola 6). Solo barbieri
-- attivi abilitati a un servizio attivo; p_barber_id null = tutti i candidati. Le chiusure
-- escono sempre. Gli intervalli sono tagliati su [p_from, p_to) e sulla finestra prenotabile
-- [now(), inizio del giorno locale oggi + max_horizon_days + 1): niente storico, niente
-- occupazione oltre l'orizzonte. Le prenotazioni si leggono fino a 60 minuti oltre (il buffer
-- massimo di shop_settings): uno slot che finisce a ridosso della fine del periodo deve vedere
-- la prenotazione successiva che il suo buffer toccherebbe.
create function public.availability_inputs(
  p_service_id uuid,
  p_barber_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (kind public.availability_kind, barber_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with win as (
    select w.lo, w.hi, w.hi + interval '60 minutes' as busy_hi, w.tz
      from (
        select greatest(p_from, now()) as lo,
               least(p_to,
                     (((now() at time zone s.timezone)::date + s.max_horizon_days + 1)::timestamp)
                       at time zone s.timezone) as hi,
               s.timezone as tz
          from public.shop_settings s
      ) w
     where w.lo < w.hi
  ),
  candidates as (
    select b.id
      from public.barbers b
      join public.barber_services bs on bs.barber_id = b.id
      join public.services sv on sv.id = bs.service_id
     where bs.service_id = p_service_id
       and sv.is_active
       and b.is_active
       and (p_barber_id is null or b.id = p_barber_id)
  ),
  days as (
    select d::date as day
      from win,
           generate_series((win.lo at time zone win.tz)::date::timestamp,
                           (win.hi at time zone win.tz)::date::timestamp,
                           interval '1 day') as d
  ),
  raw (kind, barber_id, r) as (
    select 'work'::public.availability_kind, wh.barber_id, public.local_band_to_interval(d.day, wh.start_time, wh.end_time, win.tz)
      from candidates c
      join public.working_hours wh on wh.barber_id = c.id
      join days d on extract(isodow from d.day) = wh.weekday
     cross join win
    union all
    select 'time_off', t.barber_id, tstzrange(t.starts_at, t.ends_at, '[)')
      from candidates c
      join public.time_off t on t.barber_id = c.id
     cross join win
     where t.starts_at < win.hi and t.ends_at > win.lo
    union all
    select 'closure', null::uuid, tstzrange(sc.starts_at, sc.ends_at, '[)')
      from public.shop_closures sc
     cross join win
     where sc.starts_at < win.hi and sc.ends_at > win.lo
    union all
    select 'busy', bk.barber_id, tstzrange(bk.starts_at, bk.blocked_until, '[)')
      from candidates c
      join public.bookings bk on bk.barber_id = c.id
     cross join win
     where bk.status = 'confirmed'
       and bk.starts_at < win.busy_hi and bk.blocked_until > win.lo
  )
  select x.kind, x.barber_id, lower(x.r), upper(x.r)
    from (
      select raw.kind, raw.barber_id,
             raw.r * tstzrange(win.lo, case when raw.kind = 'busy' then win.busy_hi else win.hi end, '[)') as r
        from raw cross join win
    ) x
   where not isempty(x.r)
$$;

revoke all on function public.availability_inputs(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.availability_inputs(uuid, uuid, timestamptz, timestamptz)
  to anon, authenticated;
