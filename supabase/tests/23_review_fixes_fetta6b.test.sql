-- Regressioni della review fetta 6b. La gara fra azzeramento e no-show (miglioria 1) richiede due
-- sessioni ed è in tests/acceptance/customers-review-fixes-db.test.ts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- Miglioria 4: come search_customers, le funzioni della sezione Clienti non sono eseguibili da
-- service_role.
select ok(not has_function_privilege('service_role', 'public.reset_no_show_count(uuid)', 'execute'),
  'service_role non esegue reset_no_show_count');
select ok(not has_function_privilege('service_role', 'public.admin_customers(text, integer, integer)', 'execute'),
  'service_role non esegue admin_customers');
select ok(not has_function_privilege('service_role', 'public.admin_customer(uuid)', 'execute'),
  'service_role non esegue admin_customer');
select ok(not has_function_privilege('service_role', 'public.blocked_customer_ids(uuid[])', 'execute'),
  'service_role non esegue blocked_customer_ids');

select * from finish();
rollback;
