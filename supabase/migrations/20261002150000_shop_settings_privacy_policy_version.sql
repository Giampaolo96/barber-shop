-- Versione corrente dell'informativa privacy (SPEC §8): il consenso di un cliente vale solo
-- per questa versione. Si legge come le altre impostazioni, la scrive solo l'admin
-- (grant e policy di shop_settings sono a livello di tabella).
alter table public.shop_settings
  add column privacy_policy_version text not null default '2026-10'
    constraint shop_settings_privacy_policy_version_not_blank
      check (btrim(privacy_policy_version) <> '');
