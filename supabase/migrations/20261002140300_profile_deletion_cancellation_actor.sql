-- Eliminazione di un profilo: le prenotazioni future ancora confirmed vengono cancellate
-- con lo stato che dice chi ha eliminato l'account:
-- - cancelled_by_customer se lo elimina l'utente stesso;
-- - cancelled_by_shop se lo elimina un altro utente (l'admin).
-- Senza utente identificato (service_role senza JWT) vale cancelled_by_customer: chi
-- elimina un account per conto dello staff con la service_role deve prima cancellare
-- le prenotazioni in modo esplicito.
create or replace function public.profiles_cancel_future_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  update public.bookings
     set status = case
           when actor is not null and actor <> old.id
             then 'cancelled_by_shop'::public.booking_status
           else 'cancelled_by_customer'::public.booking_status
         end
   where customer_id = old.id
     and status = 'confirmed'
     and starts_at > now();
  return old;
end;
$$;

revoke all on function public.profiles_cancel_future_bookings() from public, anon, authenticated;
