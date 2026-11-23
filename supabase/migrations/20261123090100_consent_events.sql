-- Fetta 9b (SPEC §8): storico dei consensi, prova del consenso richiesta dal GDPR (art. 7).
-- Una riga a ogni consenso privacy e a ogni cambio del marketing, scritta solo dal trigger.
-- La legge solo l'interessato; si cancella con l'account.
create type public.consent_kind as enum ('privacy', 'marketing_on', 'marketing_off');

create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind public.consent_kind not null,
  -- Versione accettata, solo per il consenso privacy.
  policy_version text,
  created_at timestamptz not null default now()
);

alter table public.consent_events enable row level security;

create index consent_events_profile_id_idx on public.consent_events (profile_id, created_at);

revoke all on table public.consent_events from public, anon, authenticated;
grant select on table public.consent_events to authenticated;

create policy consent_events_select_own on public.consent_events
  for select to authenticated
  using (profile_id = (select auth.uid()));

create function public.profiles_log_consents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.privacy_consent_at is not null
     and new.privacy_consent_at is distinct from old.privacy_consent_at then
    insert into public.consent_events (profile_id, kind, policy_version, created_at)
    values (new.id, 'privacy', new.privacy_policy_version, new.privacy_consent_at);
  end if;

  if new.marketing_consent is distinct from old.marketing_consent then
    insert into public.consent_events (profile_id, kind, created_at)
    values (new.id,
            case when new.marketing_consent then 'marketing_on'::public.consent_kind
                 else 'marketing_off'::public.consent_kind end,
            coalesce(new.marketing_consent_at, now()));
  end if;

  return null;
end;
$$;

revoke all on function public.profiles_log_consents() from public, anon, authenticated;

create trigger profiles_log_consents
  after update of privacy_policy_version, privacy_consent_at, marketing_consent on public.profiles
  for each row execute function public.profiles_log_consents();

-- Consensi già dati prima dello storico.
insert into public.consent_events (profile_id, kind, policy_version, created_at)
select id, 'privacy', privacy_policy_version, privacy_consent_at
  from public.profiles
 where privacy_consent_at is not null;

insert into public.consent_events (profile_id, kind, created_at)
select id, 'marketing_on', marketing_consent_at
  from public.profiles
 where marketing_consent and marketing_consent_at is not null;
