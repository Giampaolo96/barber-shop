-- Review fetta 6b (miglioria 4): come search_customers, le funzioni della sezione Clienti
-- verificano is_admin()/is_staff() e senza un utente non servono a service_role. Revoke esplicito,
-- così la service role non le esegue nemmeno per errore.
revoke all on function public.reset_no_show_count(uuid) from service_role;
revoke all on function public.admin_customers(text, integer, integer) from service_role;
revoke all on function public.admin_customer(uuid) from service_role;
revoke all on function public.blocked_customer_ids(uuid[]) from service_role;
