-- Validazione di uno slot online (SPEC §3.7.2, §3.7.3, §4; fetta 5, ADR 005). Stesse regole del
-- motore TypeScript (ADR 004), ricontrollate nel database: create_online_booking la usa prima di
-- inserire, il test di coerenza verifica che accetti ogni slot proposto dal motore.
--
-- Restituisce null se lo slot è valido e libero per il barbiere, altrimenti il codice della prima
-- regola violata, in quest'ordine: service_unavailable, barber_unavailable, not_aligned, too_soon,
-- too_far, outside_hours, time_off, closed, taken. Dice solo se uno slot è prenotabile, la stessa
-- informazione degli orari liberi: nessun dato di clienti o prenotazioni.
create function public.online_slot_error(p_service_id uuid, p_barber_id uuid, p_starts_at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.shop_settings%rowtype;
  v_duration integer;
  v_end timestamptz;
  v_local timestamp;
  v_day date;
  v_work tstzmultirange;
begin
  select * into v_settings from public.shop_settings;
  if not found then
    raise exception 'shop_settings missing' using errcode = 'P0002';
  end if;

  select s.duration_min into v_duration
    from public.services s
   where s.id = p_service_id and s.is_active;
  if v_duration is null then
    return 'service_unavailable';
  end if;

  if p_barber_id is null or not exists (
    select 1
      from public.barbers b
      join public.barber_services bs on bs.barber_id = b.id
     where b.id = p_barber_id and b.is_active and bs.service_id = p_service_id
  ) then
    return 'barber_unavailable';
  end if;

  -- Griglia dell'orologio locale: minuti dalla mezzanotte multipli della granularità, secondi a zero.
  v_local := p_starts_at at time zone v_settings.timezone;
  if date_trunc('minute', v_local) <> v_local
     or (extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer)
        % v_settings.slot_granularity_min <> 0 then
    return 'not_aligned';
  end if;

  -- Anticipo minimo con bordo incluso; orizzonte riferito all'inizio, fino alla fine del giorno
  -- locale di oggi + max_horizon_days.
  if p_starts_at < now() + make_interval(mins => v_settings.min_advance_min) then
    return 'too_soon';
  end if;
  if p_starts_at >= (((now() at time zone v_settings.timezone)::date + v_settings.max_horizon_days + 1)::timestamp)
                      at time zone v_settings.timezone then
    return 'too_far';
  end if;

  v_end := p_starts_at + make_interval(mins => v_duration);

  -- Fasce di lavoro del giorno prima, del giorno e del successivo, unite se contigue (come il
  -- motore): il servizio deve stare interamente dentro una fascia unita.
  v_day := v_local::date;
  select range_agg(public.local_band_to_interval(d.day, wh.start_time, wh.end_time, v_settings.timezone))
    into v_work
    from (select v_day + o as day from generate_series(-1, 1) o) d
    join public.working_hours wh
      on wh.barber_id = p_barber_id and wh.weekday = extract(isodow from d.day);
  if v_work is null or not v_work @> tstzrange(p_starts_at, v_end, '[)') then
    return 'outside_hours';
  end if;

  if exists (
    select 1 from public.time_off t
     where t.barber_id = p_barber_id and t.starts_at < v_end and t.ends_at > p_starts_at
  ) then
    return 'time_off';
  end if;

  if exists (
    select 1 from public.shop_closures c
     where c.starts_at < v_end and c.ends_at > p_starts_at
  ) then
    return 'closed';
  end if;

  -- Come il vincolo di esclusione: il buffer corrente vale solo verso le prenotazioni successive,
  -- quelle esistenti occupano fino al proprio blocked_until.
  if exists (
    select 1 from public.bookings bk
     where bk.barber_id = p_barber_id
       and bk.status = 'confirmed'
       and bk.starts_at < v_end + make_interval(mins => v_settings.buffer_min)
       and bk.blocked_until > p_starts_at
  ) then
    return 'taken';
  end if;

  return null;
end;
$$;

revoke all on function public.online_slot_error(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.online_slot_error(uuid, uuid, timestamptz) to authenticated;
