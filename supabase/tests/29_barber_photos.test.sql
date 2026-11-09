-- Fetta 8h: modifica approvata dall'utente il 2026-11-08 (amr password nei claim staff / nome della RPC), nessuna asserzione cambiata.
-- Test di accettazione – FETTA 8d (ritratti dei barbieri). La fetta non è ancora in docs/SPEC.md:
-- le regole vengono dalle decisioni approvate dall'utente ("8d: ...") e da SPEC §3.3 (barbieri:
-- "foto"), §5.2 passo 2 (scelta del barbiere con foto), CLAUDE.md – Sicurezza.
--
-- Decisioni verificate qui:
--   1. barbers.photo_url non esiste più; al suo posto barbers.photo_path text (nullable).
--   2. Formato del percorso imposto dal check barbers_photo_path_format:
--      '<id della riga>/<32 caratteri esadecimali minuscoli>.webp'.
--   3. Bucket barber-photos: pubblico, file_size_limit 1048576, allowed_mime_types {image/webp}.
--      Policy su storage.objects limitate a bucket_id = 'barber-photos': select/insert/update/
--      delete solo per l'admin (public.is_admin()).
--   4. Grant select (photo_path) ad anon e authenticated; photo_path lo cambia solo l'admin.
--
-- Le colonne nuove sono citate solo dentro stringhe (SQL dinamico): se mancano fallisce la
-- singola asserzione, non il file. I dati sono creati dal test e annullati dal rollback.
-- Convenzione per le scritture negate: zero righe toccate o permesso negato (42501).
-- Le cancellazioni dirette da storage.objects sono bloccate dal trigger storage.protect_delete
-- (42501 per chiunque) se storage.allow_delete_query non è 'true': qui lo si imposta, come fa
-- l'API di Storage, così l'esito dipende solo dalle policy.
-- Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).
begin;
create extension if not exists pgtap with schema extensions;

select plan(62);

-- Esito di una scrittura: 'rows:<n>' oppure lo sqlstate dell'errore.
create function pg_temp.outcome(q text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception when others then
  return sqlstate;
end $f$;

-- Primo valore (come testo) restituito da una query, oppure 'ERR:<sqlstate>'.
create function pg_temp.val(q text) returns text language plpgsql as $f$
declare r text;
begin
  execute q into r;
  return r;
exception when others then
  return 'ERR:' || sqlstate;
end $f$;

create function pg_temp.mk_user(uid uuid, mail text, r text, nm text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail,
          '{}'::jsonb, '{}'::jsonb, now(), now());
  update public.profiles set role = r::public.user_role, full_name = nm where id = uid;
end $f$;

-- ---------------------------------------------------------------------------
-- Dati di base (come postgres)
-- ---------------------------------------------------------------------------
-- Barbiere A (collegato all'account barbiere del test) e barbiere B
select pg_temp.mk_user('a0000000-0000-4000-8000-0000000008d1', 'f8d-admin@qa.test', 'admin', 'F8d Titolare');
select pg_temp.mk_user('b0000000-0000-4000-8000-0000000008d1', 'f8d-barber@qa.test', 'barber', 'F8d Barbiere');
select pg_temp.mk_user('c0000000-0000-4000-8000-0000000008d1', 'f8d-customer@qa.test', 'customer', 'F8d Cliente');

insert into public.barbers (id, display_name, is_active, profile_id) values
  ('eb000000-0000-4000-8000-0000000008d1', 'F8d Barbiere A', true, 'b0000000-0000-4000-8000-0000000008d1'),
  ('eb000000-0000-4000-8000-0000000008d2', 'F8d Barbiere B', true, null);

-- Bucket estraneo: le policy del ritratto non devono valere fuori da barber-photos
insert into storage.buckets (id, name, public) values ('qa-8d-other', 'qa-8d-other', false);

-- Ritratto esistente del barbiere A (file e percorso sulla riga)
select pg_temp.outcome($q$
  insert into storage.objects (bucket_id, name)
  values ('barber-photos', 'eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.webp')
$q$);
select pg_temp.outcome($q$
  update public.barbers
     set photo_path = 'eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.webp'
   where id = 'eb000000-0000-4000-8000-0000000008d1'
$q$);

-- ===========================================================================
-- Struttura (decisioni 1 e 4)
-- ===========================================================================
select hasnt_column('public', 'barbers', 'photo_url',
  '8d dec. 1: la colonna barbers.photo_url non esiste più');
select has_column('public', 'barbers', 'photo_path',
  '8d dec. 1: esiste la colonna barbers.photo_path');
select is(
  pg_temp.val($q$ select format_type(atttypid, atttypmod) || ' notnull=' || attnotnull
                    from pg_attribute
                   where attrelid = 'public.barbers'::regclass and attname = 'photo_path' $q$),
  'text notnull=false',
  '8d dec. 1: photo_path è text e nullable');
select ok(
  exists (select 1 from pg_constraint
           where conrelid = 'public.barbers'::regclass and conname = 'barbers_photo_path_format'
             and contype = 'c'),
  '8d dec. 2: esiste il check barbers_photo_path_format su barbers');
select is(
  pg_temp.val($q$ select has_column_privilege('anon', 'public.barbers', 'photo_path', 'select') $q$),
  'true', '8d dec. 4: anon legge photo_path (grant di colonna)');
select is(
  pg_temp.val($q$ select has_column_privilege('authenticated', 'public.barbers', 'photo_path', 'select') $q$),
  'true', '8d dec. 4: authenticated legge photo_path (grant di colonna)');
select is(
  pg_temp.val($q$ select has_column_privilege('anon', 'public.barbers', 'photo_path', 'update') $q$),
  'false', '8d dec. 4: anon non ha update su photo_path');
select ok(
  not has_column_privilege('anon', 'public.barbers', 'profile_id', 'select'),
  'ADR 001 (invariato): anon continua a non leggere barbers.profile_id');

-- ===========================================================================
-- Check sul formato del percorso (decisione 2), come postgres
-- ===========================================================================
create function pg_temp.set_path_a(p text) returns text language sql as $f$
  select pg_temp.outcome(format(
    'update public.barbers set photo_path = %L where id = %L', p, 'eb000000-0000-4000-8000-0000000008d1'))
$f$;

select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d1/fedcba9876543210fedcba9876543210.webp'),
  'rows:1', '8d dec. 2: accetta <id della riga>/<32 hex minuscoli>.webp');
select is(pg_temp.set_path_a(null), 'rows:1', '8d dec. 1: photo_path null (nessun ritratto) è ammesso');
select is(pg_temp.set_path_a('foto.webp'), '23514', '8d dec. 2: rifiuta un percorso arbitrario');
select is(pg_temp.set_path_a('https://example.com/foto.webp'), '23514', '8d dec. 2: rifiuta un URL');
select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d2/0123456789abcdef0123456789abcdef.webp'),
  '23514', '8d dec. 2: rifiuta il percorso di un altro barbiere');
select is(pg_temp.set_path_a('EB000000-0000-4000-8000-0000000008D1/0123456789abcdef0123456789abcdef.webp'),
  '23514', '8d punto 5 approvato: rifiuta l''id del prefisso in maiuscolo (confronto testuale)');
select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d1/../eb000000-0000-4000-8000-0000000008d2/0123456789abcdef0123456789abcdef.webp'),
  '23514', '8d dec. 2: rifiuta un percorso con ..');
select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d1/..0123456789abcdef0123456789abcd.webp'),
  '23514', '8d dec. 2: rifiuta .. nel nome del file');
select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.png'),
  '23514', '8d dec. 2: rifiuta un''estensione diversa da .webp');
select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.WEBP'),
  '23514', '8d dec. 2: rifiuta l''estensione in maiuscolo');
select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d1/0123456789ABCDEF0123456789abcdef.webp'),
  '23514', '8d dec. 2: rifiuta esadecimali maiuscoli');
select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcde.webp'),
  '23514', '8d dec. 2: rifiuta 31 caratteri esadecimali');
select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef0.webp'),
  '23514', '8d dec. 2: rifiuta 33 caratteri esadecimali');
select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdeg.webp'),
  '23514', '8d dec. 2: rifiuta caratteri non esadecimali');
select is(pg_temp.set_path_a('/eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.webp'),
  '23514', '8d dec. 2: rifiuta la barra iniziale');
select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d1/x/0123456789abcdef0123456789abcdef.webp'),
  '23514', '8d dec. 2: rifiuta una sottocartella');
select is(pg_temp.set_path_a(E'eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.webp\n'),
  '23514', '8d dec. 2: rifiuta un a capo finale');
select is(pg_temp.set_path_a('barber-photos/eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.webp'),
  '23514', '8d dec. 2: rifiuta il nome del bucket nel percorso');
select is(
  pg_temp.outcome($q$
    insert into public.barbers (id, display_name, photo_path)
    values ('eb000000-0000-4000-8000-0000000008d3', 'F8d Barbiere C',
            'eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.webp') $q$),
  '23514', '8d dec. 2: anche in insert il prefisso deve essere l''id della riga');

-- Ripristino del ritratto di A per i test sui ruoli
select is(pg_temp.set_path_a('eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.webp'),
  'rows:1', 'ripristino del percorso del barbiere A');

-- ===========================================================================
-- Bucket (decisione 3)
-- ===========================================================================
select is(
  (select count(*)::int from storage.buckets where id = 'barber-photos' and name = 'barber-photos'),
  1, '8d dec. 3: esiste il bucket barber-photos');
select is((select public from storage.buckets where id = 'barber-photos'), true,
  '8d dec. 3: il bucket è pubblico in lettura');
select is((select file_size_limit from storage.buckets where id = 'barber-photos'), 1048576::bigint,
  '8d dec. 3: file_size_limit 1 MB (1048576)');
select is((select allowed_mime_types from storage.buckets where id = 'barber-photos'), array['image/webp'],
  '8d dec. 3: allowed_mime_types solo image/webp');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'barber-photos'),
  1, 'dati di prova: un file nel bucket (ritratto del barbiere A)');

-- ===========================================================================
-- Ruoli senza privilegi: anon, cliente, barbiere (anche sulla propria scheda)
-- ===========================================================================
-- Ogni blocco tenta: insert, update, delete di un file nel bucket; lettura dell'elenco dei file;
-- cambio e azzeramento di photo_path sulla scheda del barbiere A.

create function pg_temp.denied(o text) returns boolean language sql as $f$
  select o in ('rows:0', '42501')
$f$;

-- --- anon ---------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select set_config('storage.allow_delete_query', 'true', true);

select is(pg_temp.outcome($q$ insert into storage.objects (bucket_id, name)
  values ('barber-photos', 'eb000000-0000-4000-8000-0000000008d1/11111111111111111111111111111111.webp') $q$),
  '42501', 'anon – 8d dec. 3: non carica file nel bucket');
select ok(pg_temp.denied(pg_temp.outcome($q$ update storage.objects set metadata = '{"qa":1}'::jsonb
  where bucket_id = 'barber-photos' $q$)), 'anon – 8d dec. 3: non sostituisce file del bucket');
select ok(pg_temp.denied(pg_temp.outcome($q$ delete from storage.objects where bucket_id = 'barber-photos' $q$)),
  'anon – 8d dec. 3: non cancella file del bucket');
select is((select count(*)::int from storage.objects where bucket_id = 'barber-photos'), 0,
  'anon – 8d dec. 3: non elenca i file del bucket (la lettura passa dall''URL pubblico)');
select ok(pg_temp.denied(pg_temp.outcome($q$ update public.barbers
  set photo_path = 'eb000000-0000-4000-8000-0000000008d1/22222222222222222222222222222222.webp'
  where id = 'eb000000-0000-4000-8000-0000000008d1' $q$)), 'anon – 8d dec. 4: non cambia photo_path');
select is(pg_temp.val($q$ select photo_path from public.barbers where id = 'eb000000-0000-4000-8000-0000000008d1' $q$),
  'eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.webp',
  'anon – 8d dec. 4: legge photo_path di un barbiere attivo');
reset role;

-- --- cliente ------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'c0000000-0000-4000-8000-0000000008d1', 'role', 'authenticated')::text, true);

select is(pg_temp.outcome($q$ insert into storage.objects (bucket_id, name)
  values ('barber-photos', 'eb000000-0000-4000-8000-0000000008d1/11111111111111111111111111111111.webp') $q$),
  '42501', 'customer – 8d dec. 3: non carica file nel bucket');
select ok(pg_temp.denied(pg_temp.outcome($q$ update storage.objects set metadata = '{"qa":1}'::jsonb
  where bucket_id = 'barber-photos' $q$)), 'customer – 8d dec. 3: non sostituisce file del bucket');
select ok(pg_temp.denied(pg_temp.outcome($q$ delete from storage.objects where bucket_id = 'barber-photos' $q$)),
  'customer – 8d dec. 3: non cancella file del bucket');
select is((select count(*)::int from storage.objects where bucket_id = 'barber-photos'), 0,
  'customer – 8d dec. 3: non elenca i file del bucket');
select ok(pg_temp.denied(pg_temp.outcome($q$ update public.barbers
  set photo_path = 'eb000000-0000-4000-8000-0000000008d1/22222222222222222222222222222222.webp'
  where id = 'eb000000-0000-4000-8000-0000000008d1' $q$)), 'customer – 8d dec. 4: non cambia photo_path');
select ok(pg_temp.denied(pg_temp.outcome($q$ update public.barbers set photo_path = null
  where id = 'eb000000-0000-4000-8000-0000000008d1' $q$)), 'customer – 8d dec. 4: non azzera photo_path');
reset role;

-- --- barbiere (collegato alla scheda A) -------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-0000000008d1', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password')))::text, true);

select is(pg_temp.outcome($q$ insert into storage.objects (bucket_id, name)
  values ('barber-photos', 'eb000000-0000-4000-8000-0000000008d1/11111111111111111111111111111111.webp') $q$),
  '42501', 'barber – 8d dec. 3: non carica file nel bucket, nemmeno per la propria scheda');
select ok(pg_temp.denied(pg_temp.outcome($q$ update storage.objects set metadata = '{"qa":1}'::jsonb
  where bucket_id = 'barber-photos' $q$)), 'barber – 8d dec. 3: non sostituisce il proprio ritratto');
select ok(pg_temp.denied(pg_temp.outcome($q$ delete from storage.objects where bucket_id = 'barber-photos' $q$)),
  'barber – 8d dec. 3: non cancella il proprio ritratto');
select is((select count(*)::int from storage.objects where bucket_id = 'barber-photos'), 0,
  'barber – 8d dec. 3: non elenca i file del bucket');
select ok(pg_temp.denied(pg_temp.outcome($q$ update public.barbers
  set photo_path = 'eb000000-0000-4000-8000-0000000008d1/22222222222222222222222222222222.webp'
  where id = 'eb000000-0000-4000-8000-0000000008d1' $q$)), 'barber – 8d dec. 4: non cambia photo_path della propria scheda');
select ok(pg_temp.denied(pg_temp.outcome($q$ update public.barbers set photo_path = null
  where id = 'eb000000-0000-4000-8000-0000000008d1' $q$)), 'barber – 8d dec. 4: non azzera photo_path della propria scheda');
reset role;

-- Nessuno dei tentativi ha cambiato qualcosa
select is(pg_temp.val($q$ select photo_path from public.barbers where id = 'eb000000-0000-4000-8000-0000000008d1' $q$),
  'eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.webp',
  '8d dec. 4: dopo i tentativi dei non admin photo_path è invariato');
select is(
  (select string_agg(name || ' ' || coalesce(metadata::text, '-'), ', ' order by name)
     from storage.objects where bucket_id = 'barber-photos'),
  'eb000000-0000-4000-8000-0000000008d1/0123456789abcdef0123456789abcdef.webp -',
  '8d dec. 3: dopo i tentativi dei non admin il bucket è invariato');

-- ===========================================================================
-- Admin: tutto, ma solo nel bucket barber-photos
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-0000000008d1', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password')))::text, true);

select is(pg_temp.outcome($q$ insert into storage.objects (bucket_id, name, owner_id)
  values ('barber-photos', 'eb000000-0000-4000-8000-0000000008d2/33333333333333333333333333333333.webp',
          'a0000000-0000-4000-8000-0000000008d1') $q$),
  'rows:1', 'admin – 8d dec. 3: carica un file nel bucket');
select is((select count(*)::int from storage.objects where bucket_id = 'barber-photos'), 2,
  'admin – 8d dec. 3: legge l''elenco dei file (serve a remove)');
select is(pg_temp.outcome($q$ update storage.objects set metadata = '{"qa":1}'::jsonb
  where bucket_id = 'barber-photos'
    and name = 'eb000000-0000-4000-8000-0000000008d2/33333333333333333333333333333333.webp' $q$),
  'rows:1', 'admin – 8d dec. 3: sostituisce un file (upsert)');
select is(pg_temp.outcome($q$ delete from storage.objects
  where bucket_id = 'barber-photos'
    and name = 'eb000000-0000-4000-8000-0000000008d2/33333333333333333333333333333333.webp' $q$),
  'rows:1', 'admin – 8d dec. 3: cancella un file');
select is(pg_temp.outcome($q$ update public.barbers
  set photo_path = 'eb000000-0000-4000-8000-0000000008d2/44444444444444444444444444444444.webp'
  where id = 'eb000000-0000-4000-8000-0000000008d2' $q$),
  'rows:1', 'admin – 8d dec. 4: cambia photo_path');
select is(pg_temp.outcome($q$ update public.barbers set photo_path = null
  where id = 'eb000000-0000-4000-8000-0000000008d2' $q$),
  'rows:1', 'admin – 8d dec. 4: azzera photo_path');

-- Le policy valgono solo per barber-photos
select is(pg_temp.outcome($q$ insert into storage.objects (bucket_id, name)
  values ('qa-8d-other', 'eb000000-0000-4000-8000-0000000008d1/55555555555555555555555555555555.webp') $q$),
  '42501', 'admin – 8d dec. 3: le policy non aprono la scrittura in altri bucket');
reset role;

-- Il file messo come postgres nell'altro bucket non è visibile né cancellabile dall'admin
insert into storage.objects (bucket_id, name) values ('qa-8d-other', 'qa/altro.webp');
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-0000000008d1', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password')))::text, true);
select is((select count(*)::int from storage.objects where bucket_id = 'qa-8d-other'), 0,
  'admin – 8d dec. 3: le policy non aprono la lettura di altri bucket');
select ok(pg_temp.denied(pg_temp.outcome($q$ delete from storage.objects where bucket_id = 'qa-8d-other' $q$)),
  'admin – 8d dec. 3: le policy non aprono la cancellazione in altri bucket');
reset role;

select * from finish();
rollback;
