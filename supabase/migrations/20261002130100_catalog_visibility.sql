-- Visibilità del catalogo per chi non è staff (review fetta 1).

-- barbers.profile_id è un identificatore interno: anon legge solo le colonne pubbliche.
revoke select on public.barbers from anon;
grant select (id, display_name, photo_url, bio, is_active) on public.barbers to anon;

-- barber_services: anon e customer vedono solo le coppie con servizio e barbiere attivi.
drop policy barber_services_select on public.barber_services;

create policy barber_services_select on public.barber_services
  for select to anon, authenticated
  using (
    (select public.is_staff())
    or (
      exists (select 1 from public.services s where s.id = service_id and s.is_active)
      and exists (select 1 from public.barbers b where b.id = barber_id and b.is_active)
    )
  );
