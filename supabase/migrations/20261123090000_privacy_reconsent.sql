-- Fetta 9b (SPEC §8): quando cambia la versione dell'informativa il cliente deve accettarla di
-- nuovo prima di prenotare. Il consenso già dato resta immutabile, salvo un solo passaggio:
-- da una versione non più corrente alla versione corrente. La data la mette sempre il database.
create or replace function public.profiles_guard_consents()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_current text := (select ss.privacy_policy_version from public.shop_settings ss);
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
       and old.privacy_policy_version is distinct from v_current
       and new.privacy_policy_version is not distinct from v_current
       and new.privacy_consent_at is not distinct from old.privacy_consent_at then
      -- Nuovo consenso alla versione corrente, dopo un cambio dell'informativa.
      new.privacy_consent_at := now();
    elsif new.privacy_policy_version is distinct from old.privacy_policy_version
       or new.privacy_consent_at is distinct from old.privacy_consent_at then
      raise exception 'privacy consent cannot be changed once given'
        using errcode = '42501';
    end if;
  elsif new.privacy_policy_version is distinct from old.privacy_policy_version then
    -- Il consenso vale solo per la versione corrente dell'informativa.
    if new.privacy_policy_version is distinct from v_current then
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

revoke all on function public.profiles_guard_consents() from public, anon, authenticated;

-- Campo calcolato di PostgREST (si seleziona come una colonna di profiles): consenso dato a una
-- versione che non è più quella corrente. Blocca solo le nuove prenotazioni, non l'accesso.
create function public.privacy_consent_outdated(p public.profiles)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p.privacy_consent_at is not null
     and p.privacy_policy_version is distinct from
         (select ss.privacy_policy_version from public.shop_settings ss)
$$;

revoke all on function public.privacy_consent_outdated(public.profiles) from public, anon, authenticated;
grant execute on function public.privacy_consent_outdated(public.profiles) to authenticated;
