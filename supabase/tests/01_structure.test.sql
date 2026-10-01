-- Test di accettazione – FETTA 1 (SPEC §11: "Schema DB + RLS + seed dati demo").
-- 01 – Struttura dello schema: estensioni, enum, tabelle, tipi di colonna, vincoli, indici, funzioni.
-- Solo lettura dei cataloghi: nessun dato creato. Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(92);

-- ---------------------------------------------------------------------------
-- Helper (schema temporaneo): leggono i cataloghi senza sollevare errori se
-- l'oggetto non esiste (restituiscono NULL → l'asserzione fallisce in chiaro).
-- ---------------------------------------------------------------------------

-- RLS attiva sulla tabella public.<t>
create function pg_temp.rls_on(t text) returns boolean language sql as $f$
  select c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
$f$;

-- "colonna:tipo" (pg_type.typname) delle colonne richieste, in ordine alfabetico
create function pg_temp.cols(t text, names text[]) returns text language sql as $f$
  select string_agg(a.attname || ':' || ty.typname, ',' order by a.attname)
    from pg_attribute a join pg_type ty on ty.oid = a.atttypid
   where a.attrelid = to_regclass(t) and a.attnum > 0 and not a.attisdropped
     and a.attname = any (names)
$f$;

create function pg_temp.col_notnull(t text, col text) returns boolean language sql as $f$
  select a.attnotnull from pg_attribute a
   where a.attrelid = to_regclass(t) and a.attname = col and a.attnum > 0 and not a.attisdropped
$f$;

create function pg_temp.col_default(t text, col text) returns text language sql as $f$
  select pg_get_expr(d.adbin, d.adrelid)
    from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = to_regclass(t) and a.attname = col and not a.attisdropped
$f$;

-- azione ON DELETE della FK a colonna singola t.col → ref ('c' cascade, 'n' set null, 'r' restrict, 'a' no action)
create function pg_temp.fk_on_delete(t text, col text, ref text) returns text language sql as $f$
  select c.confdeltype::text
    from pg_constraint c
   where c.contype = 'f' and c.conrelid = to_regclass(t) and c.confrelid = to_regclass(ref)
     and array_length(c.conkey, 1) = 1
     and (select a.attname::text from pg_attribute a
           where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = col
$f$;

-- esiste un indice valido e non parziale su t le cui prime colonne sono esattamente cols
create function pg_temp.has_leading_index(t text, cols text[]) returns boolean language sql as $f$
  select exists (
    select 1 from pg_index i
     where i.indrelid = to_regclass(t) and i.indisvalid and i.indpred is null
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
             where k.ord <= array_length(cols, 1)) = cols)
$f$;

-- definizioni dei vincoli di esclusione della tabella
create function pg_temp.excl_def(t text) returns text language sql as $f$
  select string_agg(pg_get_constraintdef(c.oid), ' | ')
    from pg_constraint c where c.contype = 'x' and c.conrelid = to_regclass(t)
$f$;

create function pg_temp.fn_prop(fname text)
returns table (secdef boolean, vol text, sp_empty boolean, sp_set boolean) language sql as $f$
  select p.prosecdef,
         p.provolatile::text,
         coalesce((select bool_or(c ~ '^search_path=("")?$') from unnest(p.proconfig) c), false),
         coalesce((select bool_or(c ~ '^search_path=') from unnest(p.proconfig) c), false)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = fname
$f$;

-- ---------------------------------------------------------------------------
-- Estensione ed enum
-- ---------------------------------------------------------------------------

-- SPEC §3.7.1: vincolo di esclusione su tstzrange (estensione btree_gist)
select ok(exists (select 1 from pg_extension where extname = 'btree_gist'),
  'SPEC §3.7.1: estensione btree_gist installata');

-- SPEC §2: ruoli
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e where e.enumtypid = to_regtype('public.user_role')),
  array['customer', 'barber', 'admin'],
  'SPEC §2: enum user_role = (customer, barber, admin)');

-- SPEC §3.6: stati
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e where e.enumtypid = to_regtype('public.booking_status')),
  array['confirmed', 'completed', 'cancelled_by_customer', 'cancelled_by_shop', 'no_show'],
  'SPEC §3.6: enum booking_status con i 5 stati');

-- SPEC §3.6: source
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e where e.enumtypid = to_regtype('public.booking_source')),
  array['online', 'manual'],
  'SPEC §3.6: enum booking_source = (online, manual)');

-- ---------------------------------------------------------------------------
-- SPEC §8 / CLAUDE.md – Sicurezza: RLS attiva su TUTTE le tabelle
-- ---------------------------------------------------------------------------
select is(pg_temp.rls_on('profiles'), true, 'SPEC §8: RLS attiva su profiles');
select is(pg_temp.rls_on('shop_settings'), true, 'SPEC §8: RLS attiva su shop_settings');
select is(pg_temp.rls_on('services'), true, 'SPEC §8: RLS attiva su services');
select is(pg_temp.rls_on('barbers'), true, 'SPEC §8: RLS attiva su barbers');
select is(pg_temp.rls_on('barber_services'), true, 'SPEC §8: RLS attiva su barber_services');
select is(pg_temp.rls_on('working_hours'), true, 'SPEC §8: RLS attiva su working_hours');
select is(pg_temp.rls_on('time_off'), true, 'SPEC §8: RLS attiva su time_off');
select is(pg_temp.rls_on('shop_closures'), true, 'SPEC §8: RLS attiva su shop_closures');
select is(pg_temp.rls_on('bookings'), true, 'SPEC §8: RLS attiva su bookings');

select is_empty(
  $q$ select c.relname::text
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $q$,
  'SPEC §8: nessuna tabella dello schema public senza RLS');

-- ---------------------------------------------------------------------------
-- Colonne e tipi
-- ---------------------------------------------------------------------------

-- SPEC §2 / §3.6: profiles
select is(
  pg_temp.cols('public.profiles',
    array['id', 'role', 'full_name', 'phone', 'no_show_count', 'is_blocked', 'created_at']),
  'created_at:timestamptz,full_name:text,id:uuid,is_blocked:bool,no_show_count:int4,phone:text,role:user_role',
  'SPEC §2: colonne e tipi di profiles');
select is(pg_temp.col_notnull('public.profiles', 'role'), true, 'SPEC §2: profiles.role NOT NULL');
select matches(pg_temp.col_default('public.profiles', 'role'), '^''customer''',
  'SPEC §2: profiles.role default customer');
select is(pg_temp.col_notnull('public.profiles', 'phone'), false,
  'SPEC §5.5: profiles.phone è nullable (decisione fetta 1)');
select is(pg_temp.col_notnull('public.profiles', 'no_show_count'), true,
  'SPEC §6.7: profiles.no_show_count NOT NULL');
select is(pg_temp.col_default('public.profiles', 'no_show_count'), '0',
  'SPEC §6.7: profiles.no_show_count default 0');
select is(pg_temp.col_notnull('public.profiles', 'is_blocked'), true,
  'SPEC §6.7: profiles.is_blocked NOT NULL');
select is(pg_temp.col_default('public.profiles', 'is_blocked'), 'false',
  'SPEC §6.7: profiles.is_blocked default false');
select is(pg_temp.fk_on_delete('public.profiles', 'id', 'auth.users'), 'c',
  'SPEC §8: profiles.id → auth.users(id) ON DELETE CASCADE');
select is(pg_temp.cols('public.profiles', array['is_barber']), null,
  'SPEC §2 (decisione): nessuna colonna is_barber su profiles');

-- SPEC §3.1: shop_settings
select is(
  pg_temp.cols('public.shop_settings', array['name', 'address', 'phone', 'logo_url', 'timezone']),
  'address:text,logo_url:text,name:text,phone:text,timezone:text',
  'SPEC §3.1: colonne descrittive di shop_settings');
select matches(
  pg_temp.cols('public.shop_settings',
    array['slot_granularity_min', 'min_advance_min', 'max_horizon_days', 'cancel_limit_min',
          'buffer_min', 'no_show_block_threshold']),
  '^buffer_min:int[24],cancel_limit_min:int[24],max_horizon_days:int[24],min_advance_min:int[24],no_show_block_threshold:int[24],slot_granularity_min:int[24]$',
  'SPEC §3.1: parametri numerici di shop_settings sono interi');
select matches(pg_temp.col_default('public.shop_settings', 'timezone'), '^''Europe/Rome''',
  'SPEC §3.1: timezone default Europe/Rome');
select is(pg_temp.col_default('public.shop_settings', 'slot_granularity_min'), '15',
  'SPEC §3.1: slot_granularity_min default 15');
select is(pg_temp.col_default('public.shop_settings', 'min_advance_min'), '60',
  'SPEC §3.1: min_advance_min default 60');
select is(pg_temp.col_default('public.shop_settings', 'max_horizon_days'), '30',
  'SPEC §3.1: max_horizon_days default 30');
select is(pg_temp.col_default('public.shop_settings', 'cancel_limit_min'), '120',
  'SPEC §3.1: cancel_limit_min default 120');
select is(pg_temp.col_default('public.shop_settings', 'buffer_min'), '0',
  'SPEC §3.1: buffer_min default 0');
select is(pg_temp.col_default('public.shop_settings', 'no_show_block_threshold'), '3',
  'SPEC §3.1: no_show_block_threshold default 3');

-- SPEC §3.2: services
select is(
  pg_temp.cols('public.services',
    array['id', 'name', 'description', 'duration_min', 'price_cents', 'is_active', 'sort_order']),
  'description:text,duration_min:int4,id:uuid,is_active:bool,name:text,price_cents:int4,sort_order:int4',
  'SPEC §3.2: colonne e tipi di services (price_cents INTEGER)');
select is(pg_temp.col_default('public.services', 'is_active'), 'true',
  'SPEC §3.2: services.is_active default true');

-- SPEC §3.3: barbers
select is(
  pg_temp.cols('public.barbers',
    array['id', 'display_name', 'photo_url', 'bio', 'is_active', 'profile_id']),
  'bio:text,display_name:text,id:uuid,is_active:bool,photo_url:text,profile_id:uuid',
  'SPEC §3.3: colonne e tipi di barbers');
select is(pg_temp.col_notnull('public.barbers', 'profile_id'), false,
  'SPEC §3.3: barbers.profile_id è opzionale (nullable)');
select ok(
  exists (
    select 1 from pg_index i
     where i.indrelid = to_regclass('public.barbers') and i.indisunique and i.indnatts = 1
       and i.indpred is null
       and (select a.attname::text from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) = 'profile_id'),
  'SPEC §3.3: barbers.profile_id è UNIQUE');
select isnt(pg_temp.fk_on_delete('public.barbers', 'profile_id', 'public.profiles'), null,
  'SPEC §3.3: barbers.profile_id → profiles(id)');
select is(pg_temp.cols('public.barbers', array['is_barber']), null,
  'SPEC §2 (decisione): nessuna colonna is_barber su barbers');

-- SPEC §3.3: barber_services
select is(
  pg_temp.cols('public.barber_services', array['barber_id', 'service_id']),
  'barber_id:uuid,service_id:uuid',
  'SPEC §3.3: colonne di barber_services');
select is(
  (select array_agg(a.attname::text order by a.attname)
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'p' and c.conrelid = to_regclass('public.barber_services')),
  array['barber_id', 'service_id'],
  'SPEC §3.3: PK di barber_services = (barber_id, service_id)');
select isnt(pg_temp.fk_on_delete('public.barber_services', 'barber_id', 'public.barbers'), null,
  'SPEC §3.3: barber_services.barber_id → barbers(id)');
select isnt(pg_temp.fk_on_delete('public.barber_services', 'service_id', 'public.services'), null,
  'SPEC §3.3: barber_services.service_id → services(id)');

-- SPEC §3.4: working_hours
select is(
  pg_temp.cols('public.working_hours',
    array['id', 'barber_id', 'weekday', 'start_time', 'end_time']),
  'barber_id:uuid,end_time:time,id:uuid,start_time:time,weekday:int2',
  'SPEC §3.4: colonne e tipi di working_hours (weekday smallint, orari time locali)');
select isnt(pg_temp.fk_on_delete('public.working_hours', 'barber_id', 'public.barbers'), null,
  'SPEC §3.4: working_hours.barber_id → barbers(id)');
select ok(
  exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
      join pg_range r on r.rngtypid = t.oid
     where n.nspname = 'public' and t.typname = 'timerange' and r.rngsubtype = 'time'::regtype),
  'SPEC §3.4: tipo range public.timerange su time');
select matches(pg_temp.excl_def('public.working_hours'),
  'USING gist \(barber_id WITH =, weekday WITH =, (public\.)?timerange\(start_time, end_time',
  'SPEC §3.4: vincolo di esclusione su (barber_id, weekday, timerange(start_time, end_time))');

-- SPEC §3.5: time_off e shop_closures
select is(
  pg_temp.cols('public.time_off', array['id', 'barber_id', 'starts_at', 'ends_at', 'reason']),
  'barber_id:uuid,ends_at:timestamptz,id:uuid,reason:text,starts_at:timestamptz',
  'SPEC §3.5: colonne e tipi di time_off');
select isnt(pg_temp.fk_on_delete('public.time_off', 'barber_id', 'public.barbers'), null,
  'SPEC §3.5: time_off.barber_id → barbers(id)');
select is_empty(
  $q$ select a.attname::text from pg_attribute a
       where a.attrelid = to_regclass('public.time_off') and a.attnum > 0 and not a.attisdropped
         and a.attname ~* '(approv|status)' $q$,
  'SPEC §13.4 (decisione): time_off senza colonne di approvazione');
select is(
  pg_temp.cols('public.shop_closures', array['id', 'starts_at', 'ends_at', 'reason']),
  'ends_at:timestamptz,id:uuid,reason:text,starts_at:timestamptz',
  'SPEC §3.5: colonne e tipi di shop_closures');

-- SPEC §3.6: bookings
select is(
  pg_temp.cols('public.bookings',
    array['id', 'customer_id', 'guest_name', 'guest_phone', 'barber_id', 'service_id',
          'starts_at', 'ends_at', 'duration_min', 'price_cents', 'buffer_min', 'blocked_until',
          'status', 'source', 'notes', 'created_at', 'status_changed_at', 'status_changed_by']),
  'barber_id:uuid,blocked_until:timestamptz,buffer_min:int4,created_at:timestamptz,customer_id:uuid,duration_min:int4,ends_at:timestamptz,guest_name:text,guest_phone:text,id:uuid,notes:text,price_cents:int4,service_id:uuid,source:booking_source,starts_at:timestamptz,status:booking_status,status_changed_at:timestamptz,status_changed_by:uuid',
  'SPEC §3.6: colonne e tipi di bookings (timestamptz, price_cents INTEGER)');
select is(pg_temp.col_notnull('public.bookings', 'customer_id'), false,
  'SPEC §3.6: bookings.customer_id nullable (prenotazioni manuali di non registrati)');
select is(pg_temp.col_notnull('public.bookings', 'barber_id'), true,
  'SPEC §3.6: bookings.barber_id NOT NULL');
select is(pg_temp.col_notnull('public.bookings', 'service_id'), true,
  'SPEC §3.6: bookings.service_id NOT NULL');
select is(pg_temp.col_notnull('public.bookings', 'starts_at'), true,
  'SPEC §3.6: bookings.starts_at NOT NULL');
select is(pg_temp.col_notnull('public.bookings', 'status'), true,
  'SPEC §3.6: bookings.status NOT NULL');
select matches(pg_temp.col_default('public.bookings', 'status'), '^''confirmed''',
  'SPEC §3.6: bookings.status default confirmed');
select is(pg_temp.fk_on_delete('public.bookings', 'customer_id', 'public.profiles'), 'n',
  'SPEC §8: bookings.customer_id → profiles ON DELETE SET NULL');
select is(pg_temp.fk_on_delete('public.bookings', 'barber_id', 'public.barbers'), 'r',
  'SPEC §3.6: bookings.barber_id → barbers ON DELETE RESTRICT');
select is(pg_temp.fk_on_delete('public.bookings', 'service_id', 'public.services'), 'r',
  'SPEC §3.2: bookings.service_id → services ON DELETE RESTRICT');

select is(pg_temp.fk_on_delete('public.bookings', 'status_changed_by', 'public.profiles'), 'n',
  'SPEC §3.6: bookings.status_changed_by → profiles(id) ON DELETE SET NULL');
select is(pg_temp.col_notnull('public.bookings', 'status_changed_by'), false,
  'SPEC §3.6: bookings.status_changed_by nullable');

-- SPEC §3.7.1: vincolo di esclusione su bookings
select matches(pg_temp.excl_def('public.bookings'),
  'USING gist \(barber_id WITH =, tstzrange\(starts_at, blocked_until, ''\[\)''(::text)?\) WITH &&\)',
  'SPEC §3.7.1: esclusione su (barber_id, tstzrange(starts_at, blocked_until, ''[)''))');
select matches(pg_temp.excl_def('public.bookings'),
  'WHERE .*status = ''confirmed''',
  'SPEC §3.7.1: il vincolo di esclusione vale solo per status = confirmed');

-- SPEC §3.6: trigger BEFORE INSERT ... FOR EACH ROW che copia durata/prezzo
select ok(
  exists (
    select 1 from pg_trigger t
     where t.tgrelid = to_regclass('public.bookings') and not t.tgisinternal
       and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4),
  'SPEC §3.6: bookings ha un trigger BEFORE INSERT FOR EACH ROW');

-- ---------------------------------------------------------------------------
-- SPEC §9 / CLAUDE.md – Regole 2 e 3: timestamptz ovunque, niente float per gli importi
-- ---------------------------------------------------------------------------
select is_empty(
  $q$ select table_name || '.' || column_name
        from information_schema.columns
       where table_schema = 'public'
         and data_type in ('timestamp without time zone', 'date') $q$,
  'SPEC §9: nessuna colonna timestamp senza timezone (o date) nello schema public');
select is_empty(
  $q$ select table_name || '.' || column_name
        from information_schema.columns
       where table_schema = 'public'
         and data_type in ('numeric', 'real', 'double precision', 'money') $q$,
  'SPEC §3.2: nessuna colonna numeric/real/double/money (importi in centesimi interi)');

-- ---------------------------------------------------------------------------
-- Indici sulle colonne FK e sulle ricerche principali (senza imporre nomi)
-- ---------------------------------------------------------------------------
select ok(pg_temp.has_leading_index('public.barbers', array['profile_id']),
  'indice su barbers(profile_id)');
select ok(pg_temp.has_leading_index('public.barber_services', array['barber_id']),
  'indice su barber_services(barber_id)');
select ok(pg_temp.has_leading_index('public.barber_services', array['service_id']),
  'indice su barber_services(service_id)');
select ok(pg_temp.has_leading_index('public.working_hours', array['barber_id']),
  'indice su working_hours(barber_id)');
select ok(pg_temp.has_leading_index('public.time_off', array['barber_id']),
  'indice su time_off(barber_id)');
select ok(pg_temp.has_leading_index('public.bookings', array['service_id']),
  'indice su bookings(service_id)');
select ok(pg_temp.has_leading_index('public.bookings', array['status_changed_by']),
  'indice su bookings(status_changed_by)');
select ok(pg_temp.has_leading_index('public.bookings', array['barber_id', 'starts_at']),
  'SPEC §4: indice che inizia con bookings(barber_id, starts_at)');
select ok(pg_temp.has_leading_index('public.bookings', array['customer_id', 'starts_at']),
  'SPEC §5.3: indice che inizia con bookings(customer_id, starts_at)');
select is_empty(
  $q$ select c.conrelid::regclass::text || ' ' || c.conname
        from pg_constraint c join pg_namespace n on n.oid = c.connamespace
       where c.contype = 'f' and n.nspname = 'public'
         and not exists (
           select 1 from pg_index i
            where i.indrelid = c.conrelid and i.indisvalid and i.indpred is null
              and i.indkey[0] = c.conkey[1]) $q$,
  'ogni FK dello schema public ha un indice che inizia con la sua colonna');

-- ---------------------------------------------------------------------------
-- Funzioni di supporto alle policy (CLAUDE.md – Sicurezza)
-- ---------------------------------------------------------------------------
select is((select secdef from pg_temp.fn_prop('current_user_role')), true,
  'current_user_role() è SECURITY DEFINER');
select is((select vol from pg_temp.fn_prop('current_user_role')), 's',
  'current_user_role() è STABLE');
select is((select sp_empty from pg_temp.fn_prop('current_user_role')), true,
  'current_user_role() ha search_path = ''''');
select is((select secdef from pg_temp.fn_prop('is_admin')), true, 'is_admin() è SECURITY DEFINER');
select is((select vol from pg_temp.fn_prop('is_admin')), 's', 'is_admin() è STABLE');
select is((select sp_empty from pg_temp.fn_prop('is_admin')), true,
  'is_admin() ha search_path = ''''');
select is((select secdef from pg_temp.fn_prop('is_staff')), true, 'is_staff() è SECURITY DEFINER');
select is((select vol from pg_temp.fn_prop('is_staff')), 's', 'is_staff() è STABLE');
select is((select sp_empty from pg_temp.fn_prop('is_staff')), true,
  'is_staff() ha search_path = ''''');

-- SPEC §6.2: ricerca cliente esistente
select is((select secdef from pg_temp.fn_prop('search_customers')), true,
  'SPEC §6.2: search_customers(q) è SECURITY DEFINER');
select is((select sp_set from pg_temp.fn_prop('search_customers')), true,
  'SPEC §6.2: search_customers(q) fissa il search_path');
select is(
  (select pg_get_function_identity_arguments(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_customers'),
  'q text',
  'SPEC §6.2: firma search_customers(q text)');

-- SPEC §2: trigger di registrazione su auth.users
select ok(
  exists (
    select 1 from pg_trigger t
     where t.tgrelid = to_regclass('auth.users') and not t.tgisinternal
       and (t.tgtype & 4) = 4),
  'SPEC §2: esiste un trigger INSERT su auth.users che crea il profilo');

select * from finish();
rollback;
