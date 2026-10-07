-- Fetta 6c (ADR 008): il barbiere (staff non admin) può spostare l'orario di una propria
-- prenotazione confirmed non ancora iniziata, nella propria colonna. Cambia solo starts_at:
-- fine e buffer li ricalcola questo trigger, e i vincoli di esclusione restano validi.
-- Il resto di bookings_before_write è invariato rispetto a 20261005090100_barber_cancel_by_customer.sql.

create or replace function public.bookings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.id is distinct from old.id or new.created_at is distinct from old.created_at) then
    raise exception 'id and created_at of a booking cannot be changed'
      using errcode = '42501';
  end if;

  -- Staff non admin (barbiere): può cambiare solo stato, note e nominativo dell'ospite, e
  -- l'orario di inizio (fetta 6c). Da confirmed può segnare completata, no-show o una delle due
  -- cancellazioni (fetta 6: la disdetta telefonica del cliente è cancelled_by_customer).
  -- Il confronto avviene prima dei ricalcoli, così un valore falsificato viene rifiutato
  -- e non sovrascritto.
  if tg_op = 'UPDATE' and current_user = 'authenticated' and not public.is_admin() then
    if (new.barber_id, new.service_id, new.customer_id, new.ends_at,
        new.duration_min, new.price_cents, new.buffer_min, new.source)
       is distinct from
       (old.barber_id, old.service_id, old.customer_id, old.ends_at,
        old.duration_min, old.price_cents, old.buffer_min, old.source) then
      raise exception 'only an admin can change barber, service, customer, duration or price of a booking'
        using errcode = '42501';
    end if;

    -- Spostamento (fetta 6c): solo una confirmed non ancora iniziata, senza cambiare lo stato
    -- nello stesso update. La destinazione può essere nel passato (avviso lato applicazione).
    if new.starts_at is distinct from old.starts_at
       and (old.status <> 'confirmed'
            or new.status is distinct from old.status
            or old.starts_at <= now()) then
      raise exception 'only a confirmed booking that has not started can be moved'
        using errcode = '42501';
    end if;

    if new.status is distinct from old.status
       and (old.status <> 'confirmed'
            or new.status not in ('completed', 'no_show', 'cancelled_by_customer', 'cancelled_by_shop')) then
      raise exception 'status transition % -> % not allowed', old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  -- In creazione lo staff non admin può inserire solo prenotazioni confirmed: gli altri
  -- stati si raggiungono con le transizioni ammesse.
  if tg_op = 'INSERT' and current_user = 'authenticated' and not public.is_admin()
     and new.status <> 'confirmed' then
    raise exception 'a new booking must be confirmed'
      using errcode = '42501';
  end if;

  -- SPEC §3.7.3: il barbiere deve essere abilitato al servizio (anche per le manuali).
  if tg_op = 'INSERT'
     or new.barber_id is distinct from old.barber_id
     or new.service_id is distinct from old.service_id then
    if not exists (
      select 1 from public.barber_services bs
       where bs.barber_id = new.barber_id and bs.service_id = new.service_id
    ) then
      raise exception 'barber is not enabled for this service'
        using errcode = '23514';
    end if;
  end if;

  -- Durata e prezzo copiati dal servizio alla creazione e al cambio di servizio.
  -- Negli altri update restano i valori passati: solo l'admin arriva fin qui con
  -- durata o prezzo modificati.
  if tg_op = 'INSERT' or new.service_id is distinct from old.service_id then
    select s.duration_min, s.price_cents
      into new.duration_min, new.price_cents
      from public.services s
     where s.id = new.service_id;
  end if;

  -- Il buffer resta quello in vigore alla creazione.
  if tg_op = 'INSERT' then
    new.buffer_min := coalesce((select ss.buffer_min from public.shop_settings ss), 0);
  else
    new.buffer_min := old.buffer_min;
  end if;

  new.ends_at := new.starts_at + make_interval(mins => new.duration_min);
  new.blocked_until := new.ends_at + make_interval(mins => new.buffer_min);

  -- completed e no_show solo per appuntamenti già iniziati: vale in creazione, al cambio
  -- di stato e quando si sposta l'orario.
  if new.status in ('completed', 'no_show') and new.starts_at > now()
     and (tg_op = 'INSERT'
          or new.status is distinct from old.status
          or new.starts_at is distinct from old.starts_at) then
    raise exception 'a booking can be % only after it has started', new.status
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    -- Gli utenti non scelgono created_at; i ruoli di servizio possono (seed, import).
    if current_user = 'authenticated' then
      new.created_at := now();
    else
      new.created_at := coalesce(new.created_at, now());
    end if;
    new.status_changed_at := new.created_at;
    new.status_changed_by := (select auth.uid());
  elsif new.status is distinct from old.status then
    new.status_changed_at := clock_timestamp();
    new.status_changed_by := (select auth.uid());
  else
    new.status_changed_at := old.status_changed_at;
    -- Il client non può falsificare l'autore; resta ammesso l'azzeramento fatto dalla FK
    -- (on delete set null), che gira come proprietario della tabella.
    if not (new.status_changed_by is null and current_user <> 'authenticated') then
      new.status_changed_by := old.status_changed_by;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.bookings_before_write() from public, anon, authenticated;
