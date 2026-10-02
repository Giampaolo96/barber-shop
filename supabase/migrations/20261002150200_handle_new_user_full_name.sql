-- Registrazione: il profilo nasce sempre customer; dai metadati del signup si copia solo
-- il nome (full_name, altrimenti name), senza spazi ai bordi e al massimo 100 caratteri.
-- Ruolo, blocco, telefono e consensi nei metadati sono ignorati.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  candidate text;
begin
  candidate := coalesce(
    case when jsonb_typeof(meta -> 'full_name') = 'string'
      then nullif(btrim(meta ->> 'full_name'), '') end,
    case when jsonb_typeof(meta -> 'name') = 'string'
      then nullif(btrim(meta ->> 'name'), '') end
  );

  insert into public.profiles (id, full_name)
  values (new.id, nullif(btrim(left(candidate, 100)), ''));
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
