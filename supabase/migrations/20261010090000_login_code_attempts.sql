-- Fetta 8: limite dei tentativi del login con codice a 6 cifre (ADR 009). GoTrue limita le
-- verifiche solo per IP, e le verifiche partono dal server dell'app: il limite per email sta qui.
-- Regole: 5 errori per codice (azzerati quando si chiede un nuovo codice) e al massimo 10 errori
-- per email in una finestra fissa di un'ora dal primo errore. Un login riuscito azzera tutto.
-- Le funzioni le chiama solo il server con la service_role (src/lib/auth/login-code.ts).

create table public.login_code_attempts (
  -- sha256 dell'email normalizzata (trim + minuscole): l'email in chiaro non si salva.
  email_hash text primary key,
  code_failures integer not null default 0 check (code_failures >= 0),
  hour_failures integer not null default 0 check (hour_failures >= 0),
  window_started_at timestamptz
);

alter table public.login_code_attempts enable row level security;
-- Nessuna policy: nessun ruolo dell'app legge o scrive la tabella direttamente.
revoke all on table public.login_code_attempts from public, anon, authenticated;

create function public.login_code_hash(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex')
$$;

revoke all on function public.login_code_hash(text) from public, anon, authenticated;

-- Tentativi rimasti: il minimo tra quelli del codice e quelli della finestra oraria (se ancora
-- aperta), mai negativo.
create function public.login_code_status(p_code_failures integer, p_hour_failures integer, p_window_started_at timestamptz)
returns table (blocked boolean, remaining integer)
language sql
stable
set search_path = ''
as $$
  with r as (
    select greatest(0, least(
             5 - coalesce(p_code_failures, 0),
             10 - case when p_window_started_at is not null and p_window_started_at > now() - interval '1 hour'
                       then coalesce(p_hour_failures, 0) else 0 end
           )) as remaining
  )
  select r.remaining = 0, r.remaining from r
$$;

revoke all on function public.login_code_status(integer, integer, timestamptz) from public, anon, authenticated;

create function public.login_code_check(p_email text)
returns table (blocked boolean, remaining integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.blocked, s.remaining
    from (select 1) one
    left join public.login_code_attempts a on a.email_hash = public.login_code_hash(p_email)
    cross join lateral public.login_code_status(a.code_failures, a.hour_failures, a.window_started_at) s
$$;

create function public.login_code_register_failure(p_email text)
returns table (blocked boolean, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.login_code_attempts;
begin
  insert into public.login_code_attempts as a (email_hash, code_failures, hour_failures, window_started_at)
  values (public.login_code_hash(p_email), 1, 1, now())
  on conflict (email_hash) do update
     set code_failures = a.code_failures + 1,
         -- Finestra scaduta (o mai aperta): l'errore ne apre una nuova.
         hour_failures = case when a.window_started_at > now() - interval '1 hour'
                              then a.hour_failures + 1 else 1 end,
         window_started_at = case when a.window_started_at > now() - interval '1 hour'
                                  then a.window_started_at else now() end
  returning * into v_row;

  return query
    select s.blocked, s.remaining
      from public.login_code_status(v_row.code_failures, v_row.hour_failures, v_row.window_started_at) s;
end
$$;

-- Nuovo codice richiesto: riparte il contatore del codice, il tetto orario resta.
create function public.login_code_reset(p_email text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.login_code_attempts
     set code_failures = 0
   where email_hash = public.login_code_hash(p_email)
$$;

-- Login riuscito: chi ha il codice giusto non ha bisogno di altri limiti.
create function public.login_code_clear(p_email text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.login_code_attempts
   where email_hash = public.login_code_hash(p_email)
$$;

revoke all on function public.login_code_check(text) from public, anon, authenticated;
revoke all on function public.login_code_register_failure(text) from public, anon, authenticated;
revoke all on function public.login_code_reset(text) from public, anon, authenticated;
revoke all on function public.login_code_clear(text) from public, anon, authenticated;
grant execute on function public.login_code_check(text) to service_role;
grant execute on function public.login_code_register_failure(text) to service_role;
grant execute on function public.login_code_reset(text) to service_role;
grant execute on function public.login_code_clear(text) to service_role;
