-- Review fetta 5 (ADR 005):
-- - online_slot_error non distingue più l'assenza del barbiere dall'orario occupato: entrambi
--   danno `unavailable`, così un cliente non deduce le assenze. La chiusura del negozio resta
--   `closed` (è un'informazione pubblica del negozio).
-- - Con "Nessuna preferenza" create_online_booking controlla prima le regole che non dipendono
--   dal barbiere, così l'errore rispecchia la causa reale (troppo vicino, oltre l'orizzonte,
--   chiusura) invece di un generico orario non disponibile.

-- Regole dello slot indipendenti dal barbiere, in quest'ordine: service_unavailable, not_aligned,
-- too_soon, too_far, closed. null se tutte rispettate. Funzione interna, senza grant.
create function public.online_slot_shop_error(p_service_id uuid, p_starts_at timestamptz)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_settings public.shop_settings%rowtype;
  v_duration integer;
  v_end timestamptz;
  v_local timestamp;
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
  if exists (
    select 1 from public.shop_closures c
     where c.starts_at < v_end and c.ends_at > p_starts_at
  ) then
    return 'closed';
  end if;

  return null;
end;
$$;

revoke all on function public.online_slot_shop_error(uuid, timestamptz)
  from public, anon, authenticated;

-- Null se lo slot è valido e libero per il barbiere, altrimenti il codice della prima regola
-- violata: quelle del negozio (online_slot_shop_error), poi barber_unavailable, outside_hours e
-- unavailable (assenza del barbiere o orario occupato, senza distinguerli).
create or replace function public.online_slot_error(p_service_id uuid, p_barber_id uuid, p_starts_at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_error text;
  v_tz text;
  v_buffer integer;
  v_end timestamptz;
  v_day date;
  v_work tstzmultirange;
begin
  v_error := public.online_slot_shop_error(p_service_id, p_starts_at);
  if v_error is not null then
    return v_error;
  end if;

  if p_barber_id is null or not exists (
    select 1
      from public.barbers b
      join public.barber_services bs on bs.barber_id = b.id
     where b.id = p_barber_id and b.is_active and bs.service_id = p_service_id
  ) then
    return 'barber_unavailable';
  end if;

  select ss.timezone, ss.buffer_min into v_tz, v_buffer from public.shop_settings ss;
  v_end := p_starts_at
           + make_interval(mins => (select s.duration_min from public.services s where s.id = p_service_id));

  -- Fasce di lavoro del giorno prima, del giorno e del successivo, unite se contigue (come il
  -- motore): il servizio deve stare interamente dentro una fascia unita.
  v_day := (p_starts_at at time zone v_tz)::date;
  select range_agg(public.local_band_to_interval(d.day, wh.start_time, wh.end_time, v_tz))
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
    return 'unavailable';
  end if;

  -- Come il vincolo di esclusione: il buffer corrente vale solo verso le prenotazioni successive,
  -- quelle esistenti occupano fino al proprio blocked_until.
  if exists (
    select 1 from public.bookings bk
     where bk.barber_id = p_barber_id
       and bk.status = 'confirmed'
       and bk.starts_at < v_end + make_interval(mins => v_buffer)
       and bk.blocked_until > p_starts_at
  ) then
    return 'unavailable';
  end if;

  return null;
end;
$$;

revoke all on function public.online_slot_error(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.online_slot_error(uuid, uuid, timestamptz) to authenticated;

-- "Nessuna preferenza": regole del negozio prima della scelta del barbiere; nessun barbiere
-- libero → unavailable. Il resto è invariato rispetto a 20261004100100.
create or replace function public.create_online_booking(
  p_service_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz,
  p_notes text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
  v_settings public.shop_settings%rowtype;
  v_notes text := nullif(btrim(p_notes), '');
  v_barber uuid;
  v_error text;
  v_end timestamptz;
  v_day date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_customer' using errcode = 'P0001';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  if not found or v_profile.role <> 'customer' then
    raise exception 'not_customer' using errcode = 'P0001';
  end if;

  select * into v_settings from public.shop_settings;

  -- Profilo completo (SPEC §5.5) con il consenso alla versione corrente dell'informativa (§8).
  if nullif(btrim(v_profile.full_name), '') is null
     or nullif(btrim(v_profile.phone), '') is null
     or v_profile.privacy_consent_at is null
     or v_profile.privacy_policy_version is distinct from v_settings.privacy_policy_version then
    raise exception 'profile_incomplete' using errcode = 'P0001';
  end if;

  -- Blocco manuale dell'admin o per no-show (soglia 0 = disattivato), ADR 001.
  if v_profile.is_blocked
     or (v_settings.no_show_block_threshold > 0
         and v_profile.no_show_count >= v_settings.no_show_block_threshold) then
    raise exception 'blocked' using errcode = 'P0001';
  end if;

  if length(v_notes) > 500 then
    raise exception 'notes_too_long' using errcode = 'P0001';
  end if;

  -- Un cliente alla volta: i controlli seguenti (limiti e sovrapposizioni del cliente) non
  -- reggerebbero a due richieste parallele dello stesso cliente senza serializzarle.
  perform pg_advisory_xact_lock(hashtextextended('create_online_booking:' || v_uid::text, 0));

  -- Rate limiting (SPEC §8).
  if (select count(*) from public.bookings b
       where b.customer_id = v_uid and b.source = 'online' and b.status = 'confirmed'
         and b.starts_at > now()) >= 3 then
    raise exception 'too_many_future' using errcode = 'P0001';
  end if;
  if (select count(*) from public.bookings b
       where b.customer_id = v_uid and b.source = 'online'
         and b.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'too_many_recent' using errcode = 'P0001';
  end if;

  if p_barber_id is not null then
    v_error := public.online_slot_error(p_service_id, p_barber_id, p_starts_at);
    if v_error is not null then
      raise exception '%', v_error using errcode = 'P0001';
    end if;
    v_barber := p_barber_id;
  else
    -- Prima le regole che non dipendono dal barbiere: l'errore rispecchia la causa reale.
    v_error := public.online_slot_shop_error(p_service_id, p_starts_at);
    if v_error is not null then
      raise exception '%', v_error using errcode = 'P0001';
    end if;

    -- pickBarber: meno prenotazioni non cancellate nel giorno locale, poi hash di data + id.
    v_day := (p_starts_at at time zone v_settings.timezone)::date;
    v_day_start := v_day::timestamp at time zone v_settings.timezone;
    v_day_end := (v_day + 1)::timestamp at time zone v_settings.timezone;
    select c.id into v_barber
      from (
        select b.id
          from public.barbers b
          join public.barber_services bs on bs.barber_id = b.id
         where bs.service_id = p_service_id and b.is_active
      ) c
     where public.online_slot_error(p_service_id, c.id, p_starts_at) is null
     order by (select count(*) from public.bookings bk
                where bk.barber_id = c.id
                  and bk.status in ('confirmed', 'completed', 'no_show')
                  and bk.starts_at >= v_day_start and bk.starts_at < v_day_end),
              public.fnv1a_32(to_char(v_day, 'YYYY-MM-DD') || ':' || c.id::text),
              c.id::text
     limit 1;
    if v_barber is null then
      raise exception 'unavailable' using errcode = 'P0001';
    end if;
  end if;

  -- Il cliente non ha due appuntamenti contemporanei, nemmeno con barbieri diversi.
  v_end := p_starts_at + make_interval(mins => (select s.duration_min from public.services s where s.id = p_service_id));
  if exists (
    select 1 from public.bookings b
     where b.customer_id = v_uid and b.status = 'confirmed'
       and b.starts_at < v_end and b.ends_at > p_starts_at
  ) then
    raise exception 'customer_overlap' using errcode = 'P0001';
  end if;

  -- Durata, prezzo, buffer, ends_at e blocked_until li calcola il trigger; i valori qui sono segnaposto.
  insert into public.bookings (customer_id, barber_id, service_id, starts_at, ends_at, duration_min,
                               price_cents, buffer_min, blocked_until, status, source, notes,
                               status_changed_at)
  values (v_uid, v_barber, p_service_id, p_starts_at, p_starts_at, 1, 0, 0, p_starts_at,
          'confirmed', 'online', v_notes, now())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_online_booking(uuid, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.create_online_booking(uuid, uuid, timestamptz, text) to authenticated;
