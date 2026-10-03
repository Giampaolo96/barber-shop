-- Impostazioni (SPEC §3.1, decisioni fetta 3): passo degli orari solo fra 5, 10, 15, 20, 30, 60
-- minuti, orizzonte di almeno un giorno, riga singola non eliminabile dall'app.
alter table public.shop_settings
  drop constraint shop_settings_slot_granularity_min_check,
  add constraint shop_settings_slot_granularity_min_check
    check (slot_granularity_min in (5, 10, 15, 20, 30, 60)),
  drop constraint shop_settings_max_horizon_days_check,
  add constraint shop_settings_max_horizon_days_check check (max_horizon_days >= 1);

revoke delete on public.shop_settings from authenticated;
