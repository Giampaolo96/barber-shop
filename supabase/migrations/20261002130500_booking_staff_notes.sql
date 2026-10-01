-- Note interne dello staff su una prenotazione. Stanno in una tabella separata perché
-- cliente e staff condividono il ruolo Postgres authenticated: una colonna di bookings
-- sarebbe leggibile anche dal cliente. bookings.notes resta la nota visibile al cliente.
create table public.booking_staff_notes (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  note text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.booking_staff_notes enable row level security;

create index booking_staff_notes_updated_by_idx on public.booking_staff_notes (updated_by);

-- updated_at e updated_by li valorizza il database, non il client.
create function public.booking_staff_notes_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Gli update dei ruoli di servizio passano invariati: fra questi l'azzeramento di
  -- updated_by fatto dalla FK (on delete set null), che gira come proprietario.
  if tg_op = 'UPDATE' and current_user <> 'authenticated' then
    return new;
  end if;

  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

revoke all on function public.booking_staff_notes_touch() from public, anon, authenticated;

create trigger booking_staff_notes_touch
  before insert or update on public.booking_staff_notes
  for each row execute function public.booking_staff_notes_touch();

-- Solo staff: il barbiere sulle proprie prenotazioni, l'admin su tutte.
grant select, insert, update, delete on public.booking_staff_notes to authenticated;

create policy booking_staff_notes_staff on public.booking_staff_notes
  for all to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.bookings b
       where b.id = booking_id
         and b.barber_id = (select public.current_barber_id())
    )
  )
  with check (
    (select public.is_admin())
    or exists (
      select 1 from public.bookings b
       where b.id = booking_id
         and b.barber_id = (select public.current_barber_id())
    )
  );
