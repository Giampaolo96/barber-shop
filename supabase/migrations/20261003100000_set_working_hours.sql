-- Orari settimanali di un barbiere (SPEC §3.4, §6.5): l'admin sostituisce in un colpo solo tutte
-- le fasce. Security invoker: le scritture restano soggette alla RLS di working_hours; il
-- controllo esplicito sul ruolo dà un errore chiaro invece di un salvataggio a vuoto.
-- p_hours = [{"weekday": 1..7, "start_time": "HH:MM", "end_time": "HH:MM"}, ...]
create function public.set_working_hours(p_barber_id uuid, p_hours jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  slot jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'only the admin can change working hours' using errcode = '42501';
  end if;
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then
    raise exception 'p_hours must be a JSON array' using errcode = '22023';
  end if;

  -- Formato rigido HH:MM fra 00:00 e 23:59 (niente "24:00", niente secondi).
  for slot in select value from jsonb_array_elements(p_hours) loop
    if jsonb_typeof(slot) <> 'object'
       or coalesce(slot ->> 'weekday', '') !~ '^[1-7]$'
       or coalesce(slot ->> 'start_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(slot ->> 'end_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'invalid working hours slot: %', slot using errcode = '22023';
    end if;
  end loop;

  delete from public.working_hours where barber_id = p_barber_id;

  -- Inizio < fine e fasce non sovrapposte li garantiscono i vincoli della tabella: un errore
  -- annulla anche la delete qui sopra.
  insert into public.working_hours (barber_id, weekday, start_time, end_time)
  select p_barber_id, (s ->> 'weekday')::smallint, (s ->> 'start_time')::time, (s ->> 'end_time')::time
    from jsonb_array_elements(p_hours) as s;
end;
$$;

revoke all on function public.set_working_hours(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_working_hours(uuid, jsonb) to authenticated;
