-- Il cliente legge servizi e barbieri delle proprie prenotazioni anche se nel frattempo sono stati
-- disattivati (SPEC §3.2, §12; fetta 5). Su barbers restano valide le grant di colonna: solo le
-- colonne pubbliche (ADR 001). Le policy si sommano a services_select e barbers_select.
create policy services_select_own_bookings on public.services
  for select to authenticated
  using (exists (
    select 1 from public.bookings b
     where b.service_id = services.id and b.customer_id = (select auth.uid())
  ));

create policy barbers_select_own_bookings on public.barbers
  for select to authenticated
  using (exists (
    select 1 from public.bookings b
     where b.barber_id = barbers.id and b.customer_id = (select auth.uid())
  ));
