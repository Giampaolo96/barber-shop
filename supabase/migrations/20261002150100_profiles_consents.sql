-- Consensi sul profilo (SPEC §8): privacy obbligatoria e non revocabile dal profilo,
-- marketing facoltativo e revocabile. I timestamp li valorizza sempre il database.
alter table public.profiles
  add column privacy_consent_at timestamptz,
  add column privacy_policy_version text,
  add column marketing_consent boolean not null default false,
  add column marketing_consent_at timestamptz;

-- L'utente scrive solo la versione accettata e il consenso marketing; i due timestamp
-- restano senza grant di update. La lettura passa dal grant select di tabella.
grant update (privacy_policy_version, marketing_consent) on public.profiles to authenticated;

create function public.profiles_guard_consents()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Passano i ruoli di servizio (migrazioni, seed, service_role) e le funzioni
  -- security definer, che girano come proprietario.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- I consensi li dà e li revoca solo l'interessato: nemmeno l'admin tocca quelli altrui.
  if new.id is distinct from (select auth.uid()) then
    if new.privacy_consent_at is distinct from old.privacy_consent_at
       or new.privacy_policy_version is distinct from old.privacy_policy_version
       or new.marketing_consent is distinct from old.marketing_consent
       or new.marketing_consent_at is distinct from old.marketing_consent_at then
      raise exception 'consents can be changed only by the profile owner'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.privacy_consent_at is not null then
    if new.privacy_policy_version is distinct from old.privacy_policy_version
       or new.privacy_consent_at is distinct from old.privacy_consent_at then
      raise exception 'privacy consent cannot be changed once given'
        using errcode = '42501';
    end if;
  elsif new.privacy_policy_version is distinct from old.privacy_policy_version then
    -- Il consenso vale solo per la versione corrente dell'informativa.
    if new.privacy_policy_version is distinct from
       (select ss.privacy_policy_version from public.shop_settings ss) then
      raise exception 'privacy consent must refer to the current privacy policy version'
        using errcode = '23514';
    end if;
    new.privacy_consent_at := now();
  else
    new.privacy_consent_at := old.privacy_consent_at;
  end if;

  if new.marketing_consent is distinct from old.marketing_consent then
    new.marketing_consent_at := now();
  else
    new.marketing_consent_at := old.marketing_consent_at;
  end if;

  return new;
end;
$$;

create trigger profiles_guard_consents
  before update on public.profiles
  for each row execute function public.profiles_guard_consents();

revoke all on function public.profiles_guard_consents() from public, anon, authenticated;
