-- La riga singola di shop_settings la crea la migrazione, non il seed: in produzione il seed
-- non gira e senza riga le impostazioni (e la versione dell'informativa) mancherebbero.
-- Valori di default della SPEC §3.1; il nome è un segnaposto da cambiare dall'area admin.
insert into public.shop_settings (
  id, name, timezone, slot_granularity_min, min_advance_min, max_horizon_days,
  cancel_limit_min, buffer_min, no_show_block_threshold, privacy_policy_version
)
values (true, 'Barber Shop', 'Europe/Rome', 15, 60, 30, 120, 0, 3, '2026-10')
on conflict (id) do nothing;
