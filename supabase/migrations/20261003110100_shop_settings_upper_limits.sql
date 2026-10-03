-- Review fetta 3 (decisione dell'utente): tetti massimi dei parametri di prenotazione.
-- Anticipo minimo e limite di cancellazione al massimo 7 giorni, orizzonte al massimo 365 giorni,
-- buffer al massimo 60 minuti, soglia no-show fra 0 e 10.
alter table public.shop_settings
  drop constraint shop_settings_min_advance_min_check,
  add constraint shop_settings_min_advance_min_check
    check (min_advance_min between 0 and 10080),
  drop constraint shop_settings_max_horizon_days_check,
  add constraint shop_settings_max_horizon_days_check
    check (max_horizon_days between 1 and 365),
  drop constraint shop_settings_cancel_limit_min_check,
  add constraint shop_settings_cancel_limit_min_check
    check (cancel_limit_min between 0 and 10080),
  drop constraint shop_settings_buffer_min_check,
  add constraint shop_settings_buffer_min_check check (buffer_min between 0 and 60),
  drop constraint shop_settings_no_show_block_threshold_check,
  add constraint shop_settings_no_show_block_threshold_check
    check (no_show_block_threshold between 0 and 10);
