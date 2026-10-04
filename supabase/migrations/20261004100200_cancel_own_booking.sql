-- Cancellazione online del cliente (SPEC §5.3, §12; fetta 5, ADR 005). Il cliente non ha update
-- su bookings (ADR 001): cancella solo da qui, entro cancel_limit_min prima dell'inizio.
-- Errori P0001: not_customer, not_found (inesistente o di un altro cliente, senza distinguere),
-- not_cancellable (non confirmed), too_late (oltre il limite; esattamente al limite si cancella).
create function public.cancel_own_booking(p_booking_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
begin
  if v_uid is null or not exists (
    select 1 from public.profiles p where p.id = v_uid and p.role = 'customer'
  ) then
    raise exception 'not_customer' using errcode = 'P0001';
  end if;

  select * into v_booking
    from public.bookings b
   where b.id = p_booking_id and b.customer_id = v_uid
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if v_booking.status <> 'confirmed' then
    raise exception 'not_cancellable' using errcode = 'P0001';
  end if;

  if now() > v_booking.starts_at
             - make_interval(mins => (select ss.cancel_limit_min from public.shop_settings ss)) then
    raise exception 'too_late' using errcode = 'P0001';
  end if;

  -- status_changed_at e status_changed_by (il cliente) li valorizza il trigger.
  update public.bookings set status = 'cancelled_by_customer' where id = p_booking_id;
end;
$$;

revoke all on function public.cancel_own_booking(uuid) from public, anon, authenticated;
grant execute on function public.cancel_own_booking(uuid) to authenticated;
