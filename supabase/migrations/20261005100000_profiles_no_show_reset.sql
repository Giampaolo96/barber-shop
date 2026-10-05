-- Azzeramento dei no-show da parte dell'admin (SPEC §6.7, ADR 007). Da qui no_show_count conta
-- solo le no-show di prenotazioni iniziate dall'ultimo azzeramento in poi: il blocco automatico
-- (create_online_booking, online_slot_error) continua a leggere il contatore senza cambiare.
-- Il perdono copre il passato: una no-show segnata dopo l'azzeramento su una prenotazione
-- iniziata prima non conta.
alter table public.profiles
  add column no_show_reset_at timestamptz,
  add column no_show_reset_by uuid references public.profiles (id) on delete set null;

create index profiles_no_show_reset_by_idx on public.profiles (no_show_reset_by);

-- Nessun grant di update: le due colonne le scrive solo reset_no_show_count.

-- Contatore no-show: una prenotazione conta per un cliente quando esiste, è no_show, è intestata
-- a lui e non inizia prima del suo ultimo azzeramento. Ora segue anche starts_at.
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
    counted_before := old.status = 'no_show' and old.customer_id is not null
      and exists (
        select 1 from public.profiles p
         where p.id = old.customer_id
           and (p.no_show_reset_at is null or old.starts_at >= p.no_show_reset_at)
      );
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    counted_after := new.status = 'no_show' and new.customer_id is not null
      and exists (
        select 1 from public.profiles p
         where p.id = new.customer_id
           and (p.no_show_reset_at is null or new.starts_at >= p.no_show_reset_at)
      );
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
  after insert or delete or update of status, customer_id, starts_at on public.bookings
  for each row execute function public.bookings_sync_no_show_count();

revoke all on function public.bookings_sync_no_show_count() from public, anon, authenticated;

-- Azzera i no-show di un cliente: solo l'admin (non bloccato), solo profili customer.
create function public.reset_no_show_count(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'reset_no_show_count is reserved to admin'
      using errcode = '42501';
  end if;

  update public.profiles
     set no_show_count = 0,
         no_show_reset_at = now(),
         no_show_reset_by = (select auth.uid())
   where id = p_customer_id
     and role = 'customer';

  if not found then
    raise exception 'customer not found'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.reset_no_show_count(uuid) from public, anon, authenticated;
grant execute on function public.reset_no_show_count(uuid) to authenticated;
