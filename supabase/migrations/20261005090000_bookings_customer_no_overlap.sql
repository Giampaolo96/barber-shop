-- SPEC §3.7.6 su tutti i percorsi di scrittura (decisione fetta 6): un cliente registrato non può
-- avere due prenotazioni confirmed sovrapposte, nemmeno con barbieri diversi. Intervallo
-- [starts_at, ends_at), senza buffer. Le prenotazioni intestate a un ospite (customer_id null)
-- sono escluse. create_online_booking mantiene il proprio controllo (customer_overlap): il vincolo
-- copre manuali, spostamenti dell'admin, ripristino a confirmed e le gare fra percorsi diversi.
alter table public.bookings
  add constraint bookings_customer_no_overlap exclude using gist (
    customer_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed' and customer_id is not null);
