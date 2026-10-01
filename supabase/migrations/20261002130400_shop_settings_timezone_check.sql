-- shop_settings.timezone deve essere un nome di timezone valido (es. Europe/Rome):
-- un valore sbagliato farebbe fallire tutti i calcoli orari.
create function public.shop_settings_check_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = new.timezone) then
    raise exception 'unknown timezone: %', new.timezone
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger shop_settings_check_timezone
  before insert or update of timezone on public.shop_settings
  for each row execute function public.shop_settings_check_timezone();

revoke all on function public.shop_settings_check_timezone() from public, anon, authenticated;
