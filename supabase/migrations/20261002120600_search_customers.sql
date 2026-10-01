-- Ricerca cliente per la prenotazione manuale (SPEC §6.2), riservata allo staff.
-- Restituisce solo id, nome e telefono; minimo 3 caratteri, massimo 10 risultati.
create function public.search_customers(q text)
returns table (id uuid, full_name text, phone text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  term text := btrim(coalesce(q, ''));
  digits text := regexp_replace(coalesce(q, ''), '\D', '', 'g');
  name_pattern text;
begin
  if not public.is_staff() then
    raise exception 'search_customers is reserved to staff'
      using errcode = '42501';
  end if;

  if char_length(term) < 3 then
    return;
  end if;

  name_pattern := '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select p.id, p.full_name, p.phone
      from public.profiles p
     where p.role = 'customer'
       and (p.full_name ilike name_pattern
            -- sul telefono si confrontano solo le cifre
            or (char_length(digits) >= 3
                and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || digits || '%'))
     order by p.full_name, p.id
     limit 10;
end;
$$;

revoke execute on function public.search_customers(text) from public, anon;
grant execute on function public.search_customers(text) to authenticated, service_role;
