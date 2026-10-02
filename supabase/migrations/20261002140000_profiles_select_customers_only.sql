-- Il barbiere legge, oltre al proprio, solo i profili con ruolo customer dei propri clienti.
-- Senza il filtro sul ruolo, un cliente con prenotazioni promosso a staff resterebbe
-- leggibile dal barbiere di quelle prenotazioni.
drop policy profiles_select on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_admin())
    or (
      role = 'customer'
      and exists (
        select 1 from public.bookings b
         where b.customer_id = profiles.id
           and b.barber_id = (select public.current_barber_id())
      )
    )
  );
