-- Revoca lato server delle sessioni di un account (PROGRESS fetta 2): quando l'admin blocca uno
-- staff, refresh token e sessioni smettono di funzionare. L'access token già emesso resta valido
-- fino alla scadenza, ma lo staff bloccato non ha privilegi nella RLS (ADR 002).
-- Solo service_role: la chiama la server action dell'admin dopo requireRole.
create function public.revoke_user_sessions(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  -- I refresh token si cancellano a cascata con la sessione; quelli senza sessione a parte.
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
