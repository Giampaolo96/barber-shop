-- Rafforzamento di profiles dopo la review della fetta 1.

-- Guardia sui campi riservati senza il bypass per profondità dei trigger: il contatore
-- no-show è aggiornato da una funzione security definer, che passa per current_user.
create or replace function public.profiles_guard_reserved_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Passano i ruoli di servizio (migrazioni, seed, service_role) e le funzioni
  -- security definer, che girano come proprietario.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_argv[0] = 'admin' and public.is_admin() then
    return new;
  end if;

  raise exception 'reserved profile columns cannot be changed by this user'
    using errcode = '42501';
end;
$$;

-- Deve restare sempre almeno un admin: niente declassamento o eliminazione dell'ultimo.
create function public.profiles_keep_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (
       select 1 from public.profiles p where p.role = 'admin' and p.id <> old.id
     ) then
    raise exception 'the last admin cannot be removed or demoted'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_keep_last_admin
  before update of role or delete on public.profiles
  for each row execute function public.profiles_keep_last_admin();

-- Eliminazione di un profilo: le sue prenotazioni future ancora confirmed vengono
-- cancellate prima che la FK azzeri customer_id, così lo slot torna libero.
create function public.profiles_cancel_future_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bookings
     set status = 'cancelled_by_customer'
   where customer_id = old.id
     and status = 'confirmed'
     and starts_at > now();
  return old;
end;
$$;

create trigger profiles_cancel_future_bookings
  before delete on public.profiles
  for each row execute function public.profiles_cancel_future_bookings();

revoke all on function
  public.profiles_keep_last_admin(),
  public.profiles_cancel_future_bookings()
from public, anon, authenticated;
