-- Ordinamento dei servizi (SPEC §3.2, §6.4): l'admin passa l'elenco completo nel nuovo ordine.
-- Security invoker: l'update resta soggetto alla RLS di services.
create function public.reorder_services(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'only the admin can reorder services' using errcode = '42501';
  end if;

  -- Esattamente tutti i servizi, una volta sola: un elenco vecchio o parziale non si applica.
  if p_ids is null
     or cardinality(p_ids) <> (select count(distinct id) from unnest(p_ids) as t(id))
     or cardinality(p_ids) <> (select count(*) from public.services)
     or exists (select 1 from unnest(p_ids) as t(id)
                 where not exists (select 1 from public.services s where s.id = t.id)) then
    raise exception 'p_ids must list every service exactly once' using errcode = '22023';
  end if;

  update public.services s
     set sort_order = o.position
    from unnest(p_ids) with ordinality as o(id, position)
   where s.id = o.id
     and s.sort_order is distinct from o.position;
end;
$$;

revoke all on function public.reorder_services(uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_services(uuid[]) to authenticated;
