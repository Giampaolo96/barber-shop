-- Prenotazione online del cliente (SPEC §3.7, §4, §5.2, §8; fetta 5, ADR 005). Il cliente non ha
-- insert su bookings (ADR 001): crea le prenotazioni solo da qui.

-- FNV-1a a 32 bit, come fnv1a() in src/lib/availability/assign.ts: criterio di parità di
-- "Nessuna preferenza". L'input è ASCII (data e uuid), quindi caratteri e byte coincidono.
create function public.fnv1a_32(p_text text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_hash bigint := 2166136261;
  i integer;
begin
  for i in 1 .. length(p_text) loop
    v_hash := (v_hash # ascii(substr(p_text, i, 1))) * 16777619 % 4294967296;
  end loop;
  return v_hash;
end;
$$;

revoke all on function public.fnv1a_32(text) from public, anon, authenticated;

-- Crea una prenotazione online confirmed per il cliente corrente e ne restituisce l'id.
-- p_barber_id null = "Nessuna preferenza": il barbiere si sceglie qui, nella stessa transazione,
-- tra quelli per cui lo slot è valido e libero, con il criterio di pickBarber (ADR 004).
-- Errori: raise '<codice>' con SQLSTATE P0001. La sovrapposizione concorrente sullo stesso
-- barbiere resta al vincolo di esclusione (23P01).
create function public.create_online_booking(
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
    if not exists (select 1 from public.services s where s.id = p_service_id and s.is_active) then
      raise exception 'service_unavailable' using errcode = 'P0001';
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
      raise exception 'taken' using errcode = 'P0001';
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
