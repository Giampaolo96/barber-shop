-- Regressioni della review della fetta 5 (scritte durante l'implementazione, non da spec-qa).
-- online_slot_shop_error è interna: nessun ruolo dell'app la esegue direttamente.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select has_function('public', 'online_slot_shop_error', array['uuid', 'timestamp with time zone'],
  'review fetta 5: esiste online_slot_shop_error (regole dello slot indipendenti dal barbiere)');

select is(
  array[has_function_privilege('anon', 'public.online_slot_shop_error(uuid, timestamptz)', 'execute'),
        has_function_privilege('authenticated', 'public.online_slot_shop_error(uuid, timestamptz)', 'execute')],
  array[false, false],
  'CLAUDE.md – Sicurezza: online_slot_shop_error non è eseguibile da anon né da authenticated');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'online_slot_shop_error'),
  false,
  'review fetta 5: online_slot_shop_error non è security definer (la chiamano solo funzioni definer)');

select * from finish();
rollback;
