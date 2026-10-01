-- Rafforzamento di bookings dopo la review della fetta 1:
-- - id e created_at immutabili per tutti;
-- - l'admin può modificare prezzo e durata (il barbiere no); la durata ricalcola gli orari;
-- - customer_id deve puntare a un profilo con ruolo customer;
-- - il cambio di customer_id su una prenotazione no_show sposta il conteggio, e
--   l'eliminazione di una no_show lo decrementa.

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

  -- Staff non admin (barbiere): può cambiare solo stato, note e nominativo dell'ospite.
  -- Il confronto avviene prima dei ricalcoli, così un valore falsificato viene rifiutato
  -- e non sovrascritto.
  if tg_op = 'UPDATE' and current_user = 'authenticated' and not public.is_admin() then
    if (new.barber_id, new.service_id, new.customer_id, new.starts_at, new.ends_at,
        new.duration_min, new.price_cents, new.buffer_min, new.source)
       is distinct from
       (old.barber_id, old.service_id, old.customer_id, old.starts_at, old.ends_at,
        old.duration_min, old.price_cents, old.buffer_min, old.source) then
      raise exception 'only an admin can change barber, service, customer, time or price of a booking'
        using errcode = '42501';
    end if;

    if new.status is distinct from old.status
       and (old.status <> 'confirmed'
            or new.status not in ('completed', 'no_show', 'cancelled_by_shop')) then
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

-- customer_id deve puntare a un profilo customer: una prenotazione intestata a un profilo
-- staff lo renderebbe leggibile al barbiere tramite la policy profiles_select.
-- Security definer perché il barbiere non può leggere i profili che non sono suoi clienti.
create function public.bookings_check_customer_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_id is not null
     and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id)
     and not exists (
       select 1 from public.profiles p
        where p.id = new.customer_id and p.role = 'customer'
     ) then
    raise exception 'customer_id must reference a customer profile'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger bookings_check_customer_role
  before insert or update of customer_id on public.bookings
  for each row execute function public.bookings_check_customer_role();

-- Contatore no-show: segue lo stato, il cliente e l'eliminazione. Una prenotazione conta
-- per un cliente quando esiste, è no_show ed è intestata a lui.
create or replace function public.bookings_sync_no_show_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  counted_before boolean := false;
  counted_after boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    counted_before := old.status = 'no_show' and old.customer_id is not null;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    counted_after := new.status = 'no_show' and new.customer_id is not null;
  end if;

  if counted_before and counted_after and old.customer_id = new.customer_id then
    return null;
  end if;

  if counted_before then
    update public.profiles
       set no_show_count = greatest(no_show_count - 1, 0)
     where id = old.customer_id;
  end if;

  if counted_after then
    update public.profiles
       set no_show_count = no_show_count + 1
     where id = new.customer_id;
  end if;

  return null;
end;
$$;

drop trigger bookings_sync_no_show_count on public.bookings;

create trigger bookings_sync_no_show_count
  after insert or delete or update of status, customer_id on public.bookings
  for each row execute function public.bookings_sync_no_show_count();

revoke all on function public.bookings_check_customer_role() from public, anon, authenticated;
