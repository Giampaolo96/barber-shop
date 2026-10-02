-- shop_settings.timezone: confronto senza distinguere maiuscole e minuscole, valore
-- salvato nella forma canonica di pg_timezone_names (es. 'europe/rome' → 'Europe/Rome').
create or replace function public.shop_settings_check_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  canonical text;
begin
  select tz.name
    into canonical
    from pg_catalog.pg_timezone_names tz
   where lower(tz.name) = lower(btrim(new.timezone))
   order by tz.name
   limit 1;

  if canonical is null then
    raise exception 'unknown timezone: %', new.timezone
      using errcode = '23514';
  end if;

  new.timezone := canonical;
  return new;
end;
$$;

revoke all on function public.shop_settings_check_timezone() from public, anon, authenticated;
