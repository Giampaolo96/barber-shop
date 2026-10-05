-- Sezione Clienti dell'admin (SPEC §6.7, ADR 007). L'email vive in auth.users: queste funzioni
-- security definer la espongono solo all'admin non bloccato, che verificano al proprio interno.

-- Elenco e ricerca dei clienti registrati (mai ospiti né staff). q più corto di 2 caratteri
-- non filtra; sul telefono si confrontano solo le cifre (almeno 3). total_count è il numero
-- dei risultati filtrati, prima della paginazione.
create function public.admin_customers(q text default null, p_limit integer default 25, p_offset integer default 0)
returns table (
  id uuid,
  full_name text,
  phone text,
  email text,
  no_show_count integer,
  is_blocked boolean,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  term text := left(btrim(coalesce(q, '')), 100);
  digits text := regexp_replace(left(btrim(coalesce(q, '')), 100), '\D', '', 'g');
  filtered boolean;
  pattern text;
begin
  if not public.is_admin() then
    raise exception 'admin_customers is reserved to admin'
      using errcode = '42501';
  end if;

  filtered := char_length(term) >= 2;
  pattern := '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select p.id, p.full_name, p.phone, u.email::text, p.no_show_count, p.is_blocked, p.created_at,
           count(*) over () as total_count
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.role = 'customer'
       and (not filtered
            or p.full_name ilike pattern
            or u.email ilike pattern
            or (char_length(digits) >= 3
                and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || digits || '%'))
     order by p.full_name nulls last, p.id
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
     offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Scheda di un cliente; zero righe se il profilo non esiste o non è customer.
create function public.admin_customer(p_id uuid)
returns table (
  id uuid,
  full_name text,
  phone text,
  email text,
  no_show_count integer,
  is_blocked boolean,
  no_show_reset_at timestamptz,
  no_show_reset_by uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_customer is reserved to admin'
      using errcode = '42501';
  end if;

  return query
    select p.id, p.full_name, p.phone, u.email::text, p.no_show_count, p.is_blocked,
           p.no_show_reset_at, p.no_show_reset_by, p.created_at
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.id = p_id
       and p.role = 'customer';
end;
$$;

-- Etichetta "Bloccato" nella ricerca della prenotazione manuale: fra gli id dati, i clienti
-- bloccati per la prenotazione online (a mano o per no-show), con la regola di
-- create_online_booking. search_customers resta invariata.
create function public.blocked_customer_ids(p_ids uuid[])
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_threshold integer := coalesce((select s.no_show_block_threshold from public.shop_settings s limit 1), 0);
begin
  if not public.is_staff() then
    raise exception 'blocked_customer_ids is reserved to staff'
      using errcode = '42501';
  end if;

  return query
    select p.id
      from public.profiles p
     where p.id = any (p_ids)
       and p.role = 'customer'
       and (p.is_blocked
            or (v_threshold > 0 and p.no_show_count >= v_threshold));
end;
$$;

revoke all on function public.admin_customers(text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_customer(uuid) from public, anon, authenticated;
revoke all on function public.blocked_customer_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_customers(text, integer, integer) to authenticated;
grant execute on function public.admin_customer(uuid) to authenticated;
grant execute on function public.blocked_customer_ids(uuid[]) to authenticated;
