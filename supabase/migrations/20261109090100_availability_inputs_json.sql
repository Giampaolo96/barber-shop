-- Fetta 8h (audit 2026-10-30, punto 3; ADR 015): gli input del motore come un solo jsonb.
-- PostgREST taglia le risposte a max_rows (1000) senza errore: con un orizzonte lungo
-- availability_inputs perdeva le prenotazioni e proponeva orari occupati. Stesse righe e stessa
-- logica di availability_inputs (array di {kind, barber_id, starts_at, ends_at}), corpo copiato
-- così la vecchia funzione si toglie con un semplice drop. Resta in questa migrazione perché
-- l'app già in produzione la usa durante il rilascio (rimozione annotata in PROGRESS).
create function public.availability_inputs_json(
  p_service_id uuid,
  p_barber_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
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
  select coalesce(
           jsonb_agg(jsonb_build_object('kind', x.kind, 'barber_id', x.barber_id,
                                        'starts_at', lower(x.r), 'ends_at', upper(x.r))),
           '[]'::jsonb)
    from (
      select raw.kind, raw.barber_id,
             raw.r * tstzrange(win.lo, case when raw.kind = 'busy' then win.busy_hi else win.hi end, '[)') as r
        from raw cross join win
    ) x
   where not isempty(x.r)
$$;

revoke all on function public.availability_inputs_json(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.availability_inputs_json(uuid, uuid, timestamptz, timestamptz)
  to anon, authenticated;
