-- Privilegi chiusi di default anche per le sequenze nuove dello schema public.
alter default privileges in schema public revoke all on sequences from anon, authenticated, public;
