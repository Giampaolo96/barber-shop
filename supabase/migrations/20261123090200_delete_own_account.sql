-- Fetta 9b (SPEC §8): eliminazione dell'account del cliente con anonimizzazione dello storico.
-- Ordine: 1) delete_own_account() (questa migrazione) cancella le future e anonimizza;
-- 2) il server elimina l'utente Auth con la service role; la cascata auth.users → profiles
-- ripassa dal trigger qui sotto e la FK bookings.customer_id (on delete set null) stacca le
-- prenotazioni, che restano per le statistiche. Nessuna prenotazione si cancella a cascata.

-- Anonimizza le prenotazioni di un cliente. Nessun grant: la chiamano solo delete_own_account
-- e il trigger sull'eliminazione del profilo.
create function public.anonymize_customer_bookings(p_customer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Le future tornano libere. Quella già iniziata resta confirmed, anonima come le passate.
  update public.bookings
     set status = 'cancelled_by_customer'
   where customer_id = p_customer
     and status = 'confirmed'
     and starts_at > now();

  -- Le note interne possono contenere dati della persona.
  delete from public.booking_staff_notes n
   using public.bookings b
   where b.id = n.booking_id
     and b.customer_id = p_customer;

  update public.bookings
     set notes = null, guest_name = null, guest_phone = null
   where customer_id = p_customer
     and (notes is not null or guest_name is not null or guest_phone is not null);

  -- Tentativi del login con codice, indicizzati dall'impronta dell'email.
  delete from public.login_code_attempts a
   using auth.users u
   where u.id = p_customer
     and a.email_hash = public.login_code_hash(u.email);
end;
$$;

-- Nemmeno service_role, che Supabase riceve di default: il percorso è delete_own_account.
revoke all on function public.anonymize_customer_bookings(uuid) from public, anon, authenticated, service_role;

-- Il cliente avvia l'eliminazione del proprio account: agisce solo su auth.uid().
-- Lo staff no: i suoi account li gestisce l'admin (fetta 9c).
create function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if (select p.role from public.profiles p where p.id = v_user)
     is distinct from 'customer'::public.user_role then
    raise exception 'only a customer can delete their own account' using errcode = '42501';
  end if;

  perform public.anonymize_customer_bookings(v_user);
end;
$$;

revoke all on function public.delete_own_account() from public, anon, authenticated;
grant execute on function public.delete_own_account() to authenticated;

-- Qualunque eliminazione del profilo anonimizza: copre anche una prenotazione creata in un'altra
-- scheda fra delete_own_account e l'eliminazione dell'utente Auth. Lo stato della cancellazione
-- dice ancora chi ha eliminato l'account (20261002140300).
create or replace function public.profiles_cancel_future_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  update public.bookings
     set status = case
           when actor is not null and actor <> old.id
             then 'cancelled_by_shop'::public.booking_status
           else 'cancelled_by_customer'::public.booking_status
         end
   where customer_id = old.id
     and status = 'confirmed'
     and starts_at > now();

  perform public.anonymize_customer_bookings(old.id);
  return old;
end;
$$;

revoke all on function public.profiles_cancel_future_bookings() from public, anon, authenticated;
