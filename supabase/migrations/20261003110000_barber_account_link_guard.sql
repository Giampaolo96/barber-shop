-- Review fetta 3: una scheda barbiere si collega a un account solo se è ancora libera. Due admin
-- che collegano in parallelo account diversi alla stessa scheda non si sovrascrivono: il secondo
-- collegamento viene rifiutato. Per cambiare account bisogna prima scollegare (profile_id = null).
-- La guardia sta nel database perché authenticated non può leggere profile_id, nemmeno in un
-- filtro "where profile_id is null" (grant di colonna, ADR 001).
create function public.barbers_guard_account_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.profile_id is not null
     and new.profile_id is not null
     and new.profile_id <> old.profile_id then
    raise exception 'barber already linked to another account'
      using errcode = '55000', hint = 'unlink the current account first';
  end if;
  return new;
end;
$$;

revoke all on function public.barbers_guard_account_link() from public, anon, authenticated;

create trigger barbers_guard_account_link
  before update of profile_id on public.barbers
  for each row execute function public.barbers_guard_account_link();
