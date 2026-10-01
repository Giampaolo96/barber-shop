-- Grant espliciti e policy RLS per anon, customer, barber e admin (SPEC §2, §3.7.4, §8).
-- Customer, barber e admin condividono il ruolo Postgres authenticated: li distinguono
-- le policy tramite gli helper security definer.
revoke all on all tables in schema public from anon, authenticated;

-- profiles ------------------------------------------------------------------
grant select on public.profiles to authenticated;
-- no_show_count non è aggiornabile direttamente da nessuno; role e is_blocked
-- sono riservati all'admin dai trigger di guardia su profiles.
grant update (full_name, phone, role, is_blocked) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_admin())
    -- il barbiere vede solo i clienti che hanno una prenotazione con lui
    or exists (
      select 1 from public.bookings b
       where b.customer_id = profiles.id
         and b.barber_id = (select public.current_barber_id())
    )
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- shop_settings -------------------------------------------------------------
grant select on public.shop_settings to anon, authenticated;
grant insert, update, delete on public.shop_settings to authenticated;

create policy shop_settings_select on public.shop_settings
  for select to anon, authenticated
  using (true);

create policy shop_settings_admin_write on public.shop_settings
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- services ------------------------------------------------------------------
grant select on public.services to anon, authenticated;
grant insert, update, delete on public.services to authenticated;

create policy services_select on public.services
  for select to anon, authenticated
  using (is_active or (select public.is_staff()));

create policy services_admin_write on public.services
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- barbers -------------------------------------------------------------------
grant select on public.barbers to anon, authenticated;
grant insert, update, delete on public.barbers to authenticated;

create policy barbers_select on public.barbers
  for select to anon, authenticated
  using (is_active or (select public.is_staff()));

create policy barbers_admin_write on public.barbers
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- barber_services -----------------------------------------------------------
grant select on public.barber_services to anon, authenticated;
grant insert, update, delete on public.barber_services to authenticated;

create policy barber_services_select on public.barber_services
  for select to anon, authenticated
  using (true);

create policy barber_services_admin_write on public.barber_services
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- working_hours: lo staff legge tutte le fasce, scrive solo l'admin -----------
grant select, insert, update, delete on public.working_hours to authenticated;

create policy working_hours_staff_select on public.working_hours
  for select to authenticated
  using ((select public.is_staff()));

create policy working_hours_admin_write on public.working_hours
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- time_off: il barbiere gestisce solo le proprie assenze ----------------------
grant select, insert, update, delete on public.time_off to authenticated;

create policy time_off_own_or_admin on public.time_off
  for all to authenticated
  using ((select public.is_admin()) or barber_id = (select public.current_barber_id()))
  with check ((select public.is_admin()) or barber_id = (select public.current_barber_id()));

-- shop_closures: lo staff legge, scrive solo l'admin --------------------------
grant select, insert, update, delete on public.shop_closures to authenticated;

create policy shop_closures_staff_select on public.shop_closures
  for select to authenticated
  using ((select public.is_staff()));

create policy shop_closures_admin_write on public.shop_closures
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- bookings ------------------------------------------------------------------
-- Il cliente legge solo le proprie; creazione e cancellazione online arriveranno
-- con funzioni security definer (fetta 5), non con scritture dirette.
grant select, insert, update, delete on public.bookings to authenticated;

create policy bookings_select on public.bookings
  for select to authenticated
  using (
    customer_id = (select auth.uid())
    or (select public.is_admin())
    or barber_id = (select public.current_barber_id())
  );

create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (
    (select public.is_admin())
    or (source = 'manual' and barber_id = (select public.current_barber_id()))
  );

create policy bookings_update on public.bookings
  for update to authenticated
  using ((select public.is_admin()) or barber_id = (select public.current_barber_id()))
  with check ((select public.is_admin()) or barber_id = (select public.current_barber_id()));

create policy bookings_delete on public.bookings
  for delete to authenticated
  using ((select public.is_admin()));
