-- Deve restare sempre almeno un admin attivo, cioè con ruolo admin e non bloccato:
-- l'ultimo non può essere declassato, bloccato né eliminato. Gli admin bloccati non contano.
create or replace function public.profiles_keep_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_active boolean := old.role = 'admin' and not old.is_blocked;
  stays_active boolean := false;
begin
  if tg_op = 'UPDATE' then
    stays_active := new.role = 'admin' and not new.is_blocked;
  end if;

  if was_active and not stays_active
     and not exists (
       select 1 from public.profiles p
        where p.role = 'admin' and not p.is_blocked and p.id <> old.id
     ) then
    raise exception 'the last active admin cannot be removed, demoted or blocked'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_keep_last_admin() from public, anon, authenticated;

drop trigger profiles_keep_last_admin on public.profiles;

create trigger profiles_keep_last_admin
  before update of role, is_blocked or delete on public.profiles
  for each row execute function public.profiles_keep_last_admin();
