-- La riga di default di shop_settings esiste con le sole migrazioni, senza seed (SPEC §3.1).
-- I test girano dopo il seed: qui si svuota la tabella e si rieseguono le istruzioni delle
-- migrazioni registrate in supabase_migrations, per verificare che basti una migrazione a
-- creare la riga. Tutto in una transazione annullata alla fine.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

-- Istruzioni delle migrazioni che inseriscono in shop_settings
create temp table default_row_statements as
select m.version, s.ordinality, s.statement
  from supabase_migrations.schema_migrations m
 cross join lateral unnest(m.statements) with ordinality as s (statement, ordinality)
 where s.statement ~* 'insert\s+into\s+public\.shop_settings';

select ok(
  (select count(*) > 0 from default_row_statements),
  'SPEC §3.1: una migrazione inserisce la riga di shop_settings');

delete from public.shop_settings;
select is((select count(*) from public.shop_settings), 0::bigint,
  'preparazione: shop_settings svuotata (stato senza seed)');

do $$
declare r record;
begin
  for r in select statement from default_row_statements order by version, ordinality loop
    execute r.statement;
  end loop;
end $$;

select is((select count(*) from public.shop_settings), 1::bigint,
  'SPEC §3.1: dopo le sole migrazioni shop_settings ha la riga singola');
select is(
  (select row(timezone, slot_granularity_min, min_advance_min, max_horizon_days,
              cancel_limit_min, buffer_min, no_show_block_threshold)::text
     from public.shop_settings),
  '(Europe/Rome,15,60,30,120,0,3)',
  'SPEC §3.1: la riga creata dalla migrazione ha i valori di default');
select ok(
  (select btrim(name) <> '' and btrim(privacy_policy_version) <> '' from public.shop_settings),
  'SPEC §3.1 / §8: la riga ha un nome e la versione corrente dell''informativa');

select * from finish();
rollback;
