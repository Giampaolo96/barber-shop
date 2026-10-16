-- Ritratti dei barbieri (fetta 8d, ADR 011): il file sta in Supabase Storage, la riga tiene
-- solo il percorso. Sostituisce photo_url (URL https esterno, fetta 3).
alter table public.barbers drop column photo_url;

-- Percorso generato dal server: <id del barbiere>/<32 esadecimali minuscoli>.webp.
-- Il prefisso è legato all'id della riga, quindi non si può puntare al file di un altro.
alter table public.barbers add column photo_path text;
alter table public.barbers add constraint barbers_photo_path_format check (
  photo_path is null
  or photo_path ~ ('^' || id::text || '/[0-9a-f]{32}\.webp$')
);

-- Grant di colonna (ADR 001): le colonne pubbliche si ripetono per intero. L'update resta
-- quello a livello di tabella, limitato all'admin da barbers_admin_write.
revoke select on public.barbers from anon, authenticated;
grant select (id, display_name, photo_path, bio, is_active) on public.barbers to anon, authenticated;

-- Bucket pubblico in lettura (URL pubblico, nessuna policy di select per il pubblico).
-- Nessun alter sulle tabelle di storage: sono di proprietà di Supabase.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('barber-photos', 'barber-photos', true, 1048576, array['image/webp']);

-- Scritture solo per l'admin. La select serve all'admin per remove e upsert.
create policy barber_photos_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'barber-photos' and (select public.is_admin()));

create policy barber_photos_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'barber-photos' and (select public.is_admin()));

create policy barber_photos_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'barber-photos' and (select public.is_admin()))
  with check (bucket_id = 'barber-photos' and (select public.is_admin()));

create policy barber_photos_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'barber-photos' and (select public.is_admin()));
