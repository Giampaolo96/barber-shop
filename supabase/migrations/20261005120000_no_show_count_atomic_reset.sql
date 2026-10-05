-- Review fetta 6b (miglioria 1): il contatore no-show valuta la condizione sull'azzeramento nel
-- WHERE (e nel SET) dell'update del profilo. Se un azzeramento concorrente tiene il lock della
-- riga, in READ COMMITTED Postgres ricontrolla WHERE e SET sulla versione dopo il commit: una
-- no-show precedente all'azzeramento non conta più nemmeno se segnata in quel momento. Prima la
-- condizione era letta con una select separata, prima di attendere il lock (ADR 007).
create or replace function public.bookings_sync_no_show_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_customer uuid;
  new_customer uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'no_show' then
    old_customer := old.customer_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'no_show' then
    new_customer := new.customer_id;
  end if;

  -- Stesso cliente prima e dopo (es. cambio di starts_at): un solo update con la differenza.
  if old_customer is not null and old_customer = new_customer then
    update public.profiles p
       set no_show_count = greatest(
             p.no_show_count
             + (case when p.no_show_reset_at is null or new.starts_at >= p.no_show_reset_at then 1 else 0 end)
             - (case when p.no_show_reset_at is null or old.starts_at >= p.no_show_reset_at then 1 else 0 end),
             0)
     where p.id = old_customer
       and (p.no_show_reset_at is null or new.starts_at >= p.no_show_reset_at)
           <> (p.no_show_reset_at is null or old.starts_at >= p.no_show_reset_at);
    return null;
  end if;

  if old_customer is not null then
    update public.profiles p
       set no_show_count = greatest(p.no_show_count - 1, 0)
     where p.id = old_customer
       and (p.no_show_reset_at is null or old.starts_at >= p.no_show_reset_at);
  end if;

  if new_customer is not null then
    update public.profiles p
       set no_show_count = p.no_show_count + 1
     where p.id = new_customer
       and (p.no_show_reset_at is null or new.starts_at >= p.no_show_reset_at);
  end if;

  return null;
end;
$$;

revoke all on function public.bookings_sync_no_show_count() from public, anon, authenticated;
