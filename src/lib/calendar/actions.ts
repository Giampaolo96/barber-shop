"use server";

// Server action del calendario dello staff (SPEC §6.1–6.3). Ogni azione ricontrolla il ruolo e
// valida l'input con Zod; le regole di dominio le applica comunque il database (RLS, trigger e
// vincoli di esclusione). Le manuali e gli spostamenti possono derogare a fasce, assenze e
// chiusure solo dopo la conferma degli avvisi, ricalcolati a ogni invio (decisioni fetta 6).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOwnBarberId } from "@/lib/admin/queries";
import { idSchema } from "@/lib/admin/schemas";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";
import { exactLocalDateTimeToUtc } from "@/lib/domain/local-time";
import { bookingUpdateValues, editNeedsWarnings, unchangedStart, usesInactiveChoice } from "./edit";
import { type CalendarErrorCode, calendarErrorCode } from "./errors";
import { canDrag, canDropOn } from "./move";
import { bookingDetailPath, CREATED_PARAM } from "./paths";
import { getCalendarSettings, slotWarnings } from "./queries";
import {
  bookingStatusSchema,
  customerQuerySchema,
  manualBookingSchema,
  moveBookingFormSchema,
  moveBookingSchema,
  staffNoteSchema,
  updateBookingSchema,
} from "./schemas";
import { allowedTransitions } from "./transitions";
import { decideWarnings, type WarningCode } from "./warnings";

/** Esiti propri delle azioni: scelta disattivata, dato cambiato nel frattempo, ora inesistente. */
type ActionErrorCode = "inactive" | "stale" | "invalid_time";

export type CalendarFormState = {
  status: "idle" | "saved" | "invalid" | "warnings" | CalendarErrorCode | ActionErrorCode;
  /** Avvisi da confermare (status "warnings"). */
  warnings?: WarningCode[];
  /** Valori inviati, per ripresentare il modulo dopo avvisi o errori. */
  values?: Record<string, string>;
};

export type CalendarRowState = { status: "idle" | "saved" | "invalid" | "stale" | CalendarErrorCode };

/** `blocked`: bloccato per la prenotazione online; null se non è stato possibile verificarlo. */
export type CustomerMatch = { id: string; fullName: string; phone: string | null; blocked: boolean | null };

/**
 * Esito della ricerca clienti: un errore non va mostrato come "nessun cliente", e un blocco non
 * verificato non va mostrato come "non bloccato" (`blockStatusUnknown`).
 */
export type CustomerSearchResult =
  | { ok: true; matches: CustomerMatch[]; blockStatusUnknown: boolean }
  | { ok: false };

const MINUTE = 60_000;
const CALENDAR_AREA = "/admin";

/** Campi testuali del modulo (le conferme degli avvisi viaggiano a parte). */
const formValues = (formData: FormData): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (typeof value === "string" && !key.startsWith("$") && key !== "confirm" && key !== "shownWarnings") {
      values[key] = value;
    }
  }
  return values;
};

/** Avvisi confermati: quelli mostrati, solo se l'utente ha premuto "Conferma comunque". */
const confirmedWarnings = (formData: FormData): FormDataEntryValue[] =>
  formData.get("confirm") === "1" ? formData.getAll("shownWarnings") : [];

const text = (formData: FormData, key: string): string | undefined => {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
};

export async function createManualBooking(
  _previous: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const user = await requireRole(["barber", "admin"]);
  const values = formValues(formData);
  const parsed = manualBookingSchema.safeParse({
    barberId: text(formData, "barberId"),
    serviceId: text(formData, "serviceId"),
    date: text(formData, "date"),
    time: text(formData, "time"),
    customerKind: text(formData, "customerKind"),
    customerId: text(formData, "customerId") || undefined,
    guestName: text(formData, "guestName"),
    guestPhone: text(formData, "guestPhone"),
    staffNote: text(formData, "staffNote"),
    confirmedWarnings: confirmedWarnings(formData),
  });
  if (!parsed.success) return { status: "invalid", values };
  const input = parsed.data;

  const supabase = await createClient();
  let bookingId: string;
  try {
    // Il barbiere crea solo per sé (SPEC §2); la RLS lo impone comunque.
    if (user.role !== "admin" && (await getOwnBarberId(supabase)) !== input.barberId) {
      return { status: "forbidden", values };
    }

    const [{ data: service }, { data: barber }] = await Promise.all([
      supabase.from("services").select("duration_min, is_active").eq("id", input.serviceId).maybeSingle(),
      supabase.from("barbers").select("is_active").eq("id", input.barberId).maybeSingle(),
    ]);
    if (!service || !barber) return { status: "invalid", values };
    // Servizi e barbieri disattivati non sono più prenotabili (SPEC §3.2), nemmeno a mano.
    if (
      usesInactiveChoice({
        service: { changed: true, active: service.is_active },
        barber: { changed: true, active: barber.is_active },
      })
    ) {
      return { status: "inactive", values };
    }

    const { timezone } = await getCalendarSettings(supabase);
    const startsAt = exactLocalDateTimeToUtc(input.date, input.time, timezone);
    if (!startsAt) return { status: "invalid_time", values };
    const endsAt = new Date(startsAt.getTime() + service.duration_min * MINUTE);
    const current = await slotWarnings(supabase, {
      barberId: input.barberId,
      startsAt,
      endsAt,
      timezone,
      now: new Date(),
    });
    const decision = decideWarnings(current, input.confirmedWarnings);
    if (!decision.save) return { status: "warnings", warnings: decision.warnings, values };

    const customer =
      input.customerKind === "registered"
        ? { customer_id: input.customerId }
        : { guest_name: input.guestName, guest_phone: input.guestPhone };
    const { data: created, error } = await supabase
      .from("bookings")
      .insert({
        ...customer,
        barber_id: input.barberId,
        service_id: input.serviceId,
        starts_at: startsAt.toISOString(),
        status: "confirmed",
        source: "manual",
      })
      .select("id")
      .single();
    if (error || !created) return { status: error ? calendarErrorCode(error) : "error", values };
    bookingId = created.id;

    if (input.staffNote) {
      // La prenotazione esiste già: se la nota non si salva, lo staff la reinserisce dal dettaglio.
      const { error: noteError } = await supabase
        .from("booking_staff_notes")
        .insert({ booking_id: bookingId, note: input.staffNote });
      if (noteError) console.error("createManualBooking: nota staff non salvata", noteError.code);
    }
  } catch (error) {
    console.error("createManualBooking", error);
    return { status: "error", values };
  }

  revalidatePath(CALENDAR_AREA, "layout");
  redirect(`${bookingDetailPath(bookingId)}?${CREATED_PARAM}=1`);
}

/** Spostamento e modifica (SPEC §6.3): solo l'admin. */
export async function updateBooking(
  _previous: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  await requireRole(["admin"]);
  const values = formValues(formData);
  const target = idSchema.safeParse({ id: text(formData, "id") });
  if (!target.success) return { status: "invalid", values };

  const supabase = await createClient();
  try {
    const { data: existing } = await supabase
      .from("bookings")
      .select("status, barber_id, service_id, starts_at, ends_at")
      .eq("id", target.data.id)
      .maybeSingle();
    if (!existing) return { status: "forbidden", values };

    // Data e ora invariate: vale l'istante salvato (review fetta 6). Allo schema arriva un orario
    // segnaposto valido, perché quello salvato può non rispettare il passo di 5 minuti.
    const { timezone } = await getCalendarSettings(supabase);
    const kept = unchangedStart(
      new Date(existing.starts_at),
      text(formData, "date") ?? "",
      text(formData, "time") ?? "",
      timezone,
    );
    const parsed = updateBookingSchema.safeParse({
      id: target.data.id,
      barberId: text(formData, "barberId"),
      serviceId: text(formData, "serviceId"),
      date: text(formData, "date"),
      time: kept ? "00:00" : text(formData, "time"),
      durationMin: text(formData, "durationMin"),
      price: text(formData, "price"),
      confirmedWarnings: confirmedWarnings(formData),
    });
    if (!parsed.success) return { status: "invalid", values };
    const input = parsed.data;

    const startsAt = kept ?? exactLocalDateTimeToUtc(input.date, input.time, timezone);
    if (!startsAt) return { status: "invalid_time", values };

    // Cambiando servizio la durata la ricopia il database dal nuovo servizio.
    const serviceChanged = input.serviceId !== existing.service_id;
    const barberChanged = input.barberId !== existing.barber_id;
    const [{ data: service }, { data: barber }] = await Promise.all([
      supabase.from("services").select("duration_min, is_active").eq("id", input.serviceId).maybeSingle(),
      supabase.from("barbers").select("is_active").eq("id", input.barberId).maybeSingle(),
    ]);
    if (!service || !barber) return { status: "invalid", values };
    // Restano ammessi servizio e barbiere già sulla prenotazione, anche se disattivati.
    if (
      usesInactiveChoice({
        service: { changed: serviceChanged, active: service.is_active },
        barber: { changed: barberChanged, active: barber.is_active },
      })
    ) {
      return { status: "inactive", values };
    }
    const durationMin = serviceChanged ? service.duration_min : input.durationMin;

    const next = {
      barberId: input.barberId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + durationMin * MINUTE),
    };
    const before = {
      status: existing.status,
      barberId: existing.barber_id,
      startsAt: new Date(existing.starts_at),
      endsAt: new Date(existing.ends_at),
    };
    if (editNeedsWarnings(before, next)) {
      const current = await slotWarnings(supabase, { ...next, timezone, now: new Date() });
      const decision = decideWarnings(current, input.confirmedWarnings);
      if (!decision.save) return { status: "warnings", warnings: decision.warnings, values };
    }

    const { data: updated, error } = await supabase
      .from("bookings")
      .update(bookingUpdateValues({ serviceId: existing.service_id }, { ...input, startsAt }))
      .eq("id", input.id)
      .select("id");
    if (error) return { status: calendarErrorCode(error), values };
    if (updated.length !== 1) return { status: "forbidden", values };
  } catch (error) {
    console.error("updateBooking", error);
    return { status: "error", values };
  }

  revalidatePath(CALENDAR_AREA, "layout");
  // Senza valori: il modulo riparte dai dati salvati (durata e prezzo ricopiati compresi).
  return { status: "saved" };
}

/**
 * Esito di uno spostamento. `previousWarnings` sono gli avvisi della posizione di partenza:
 * l'"Annulla spostamento" li passa come già confermati (decisione fetta 6c).
 */
export type MoveResult =
  | { status: "saved"; previousWarnings: WarningCode[] }
  | { status: "warnings"; warnings: WarningCode[] }
  | { status: "invalid" | "stale" | "inactive" | CalendarErrorCode };

/**
 * Spostamento dal calendario (SPEC §6.3, ADR 008): cambia solo barbiere e inizio, mai durata e
 * prezzo. L'admin sposta qualunque confirmed non iniziata, anche tra colonne; il barbiere solo le
 * proprie e solo nell'orario. Si salva solo se la prenotazione è ancora dove l'utente l'ha vista.
 */
export async function moveBooking(input: unknown): Promise<MoveResult> {
  const user = await requireRole(["barber", "admin"]);
  const parsed = moveBookingSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const move = parsed.data;
  const role = user.role === "admin" ? "admin" : "barber";
  const startsAt = new Date(move.startsAt);
  const expectedStartsAt = new Date(move.expectedStartsAt);

  try {
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("bookings")
      .select("status, barber_id, starts_at, ends_at, duration_min")
      .eq("id", move.id)
      .maybeSingle();
    if (!existing) return { status: "forbidden" };

    const before = {
      status: existing.status,
      barberId: existing.barber_id,
      startsAt: new Date(existing.starts_at),
      endsAt: new Date(existing.ends_at),
    };
    // Posizione o stato cambiati dopo che l'utente ha visto la scheda (decisione dell'utente:
    // anche una prenotazione non più confirmed è "stale").
    if (
      before.barberId !== move.expectedBarberId ||
      before.startsAt.getTime() !== expectedStartsAt.getTime() ||
      before.status !== "confirmed"
    ) {
      return { status: "stale" };
    }

    const now = new Date();
    const isOwn = role === "admin" || (await getOwnBarberId(supabase)) === before.barberId;
    if (!canDrag({ role, status: before.status, startsAt: before.startsAt, now, isOwn })) {
      return { status: "forbidden" };
    }
    if (move.barberId !== before.barberId) {
      if (role !== "admin") return { status: "forbidden" };
      const { data: target } = await supabase
        .from("barbers")
        .select("is_active")
        .eq("id", move.barberId)
        .maybeSingle();
      if (!target) return { status: "invalid" };
      const allowed = canDropOn({
        role,
        sourceBarberId: before.barberId,
        targetBarberId: move.barberId,
        targetActive: target.is_active,
      });
      if (!allowed) return { status: "inactive" };
    }

    const next = {
      barberId: move.barberId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + existing.duration_min * MINUTE),
    };
    const { timezone } = await getCalendarSettings(supabase);
    const [current, previousWarnings] = await Promise.all([
      editNeedsWarnings(before, next) ? slotWarnings(supabase, { ...next, timezone, now }) : [],
      slotWarnings(supabase, { ...before, timezone, now }),
    ]);
    const decision = decideWarnings(current, move.confirmedWarnings);
    if (!decision.save) return { status: "warnings", warnings: decision.warnings };

    // Solo se è ancora confirmed e nella posizione letta: due spostamenti concorrenti non si
    // sovrascrivono. Il barbiere non invia barber_id (il trigger gli consente solo starts_at).
    const { data: updated, error } = await supabase
      .from("bookings")
      .update({
        starts_at: startsAt.toISOString(),
        ...(next.barberId === before.barberId ? {} : { barber_id: next.barberId }),
      })
      .eq("id", move.id)
      .eq("status", "confirmed")
      .eq("barber_id", before.barberId)
      .eq("starts_at", before.startsAt.toISOString())
      .select("id");
    if (error) return { status: calendarErrorCode(error) };
    if (updated.length !== 1) return { status: "stale" };

    revalidatePath(CALENDAR_AREA, "layout");
    return { status: "saved", previousWarnings };
  } catch (error) {
    console.error("moveBooking", error);
    return { status: "error" };
  }
}

/**
 * Modulo "Sposta orario" del dettaglio (fetta 6c): alternativa accessibile al trascinamento, con
 * la stessa logica di `moveBooking` e nella stessa colonna.
 */
export async function moveBookingFromForm(
  _previous: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  await requireRole(["barber", "admin"]);
  const values = formValues(formData);
  const parsed = moveBookingFormSchema.safeParse({
    id: text(formData, "id"),
    date: text(formData, "date"),
    time: text(formData, "time"),
    expectedBarberId: text(formData, "expectedBarberId"),
    expectedStartsAt: text(formData, "expectedStartsAt"),
    confirmedWarnings: confirmedWarnings(formData),
  });
  if (!parsed.success) return { status: "invalid", values };
  const input = parsed.data;

  let timezone: string;
  try {
    ({ timezone } = await getCalendarSettings(await createClient()));
  } catch (error) {
    console.error("moveBookingFromForm", error);
    return { status: "error", values };
  }
  const startsAt = exactLocalDateTimeToUtc(input.date, input.time, timezone);
  if (!startsAt) return { status: "invalid_time", values };

  const result = await moveBooking({
    id: input.id,
    barberId: input.expectedBarberId,
    startsAt: startsAt.toISOString(),
    expectedBarberId: input.expectedBarberId,
    expectedStartsAt: input.expectedStartsAt,
    confirmedWarnings: input.confirmedWarnings,
  });
  if (result.status === "saved") return { status: "saved" };
  if (result.status === "warnings") return { status: "warnings", warnings: result.warnings, values };
  return { status: result.status, values };
}

/** Cambio di stato (SPEC §3.6): le transizioni ammesse per ruolo le ricontrolla anche il database. */
export async function changeBookingStatus(
  _previous: CalendarRowState,
  formData: FormData,
): Promise<CalendarRowState> {
  const user = await requireRole(["barber", "admin"]);
  const parsed = bookingStatusSchema.safeParse({
    id: text(formData, "id"),
    status: text(formData, "status"),
  });
  // Stato mostrato dalla pagina al momento del clic: se nel frattempo è cambiato, si chiede di ricaricare.
  const expected = bookingStatusSchema.shape.status.safeParse(text(formData, "expectedStatus"));
  if (!parsed.success || !expected.success) return { status: "invalid" };

  try {
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("bookings")
      .select("status, starts_at")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (!existing) return { status: "forbidden" };
    if (existing.status !== expected.data) return { status: "stale" };

    const allowed = allowedTransitions({
      role: user.role === "admin" ? "admin" : "barber",
      status: existing.status,
      startsAt: new Date(existing.starts_at),
      now: new Date(),
    });
    if (!allowed.includes(parsed.data.status)) return { status: "forbidden" };

    // Solo se lo stato è ancora quello letto: due cambi concorrenti non si sovrascrivono.
    const { data: updated, error } = await supabase
      .from("bookings")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.id)
      .eq("status", existing.status)
      .select("id");
    if (error) return { status: calendarErrorCode(error) };
    if (updated.length !== 1) return { status: "stale" };
  } catch (error) {
    console.error("changeBookingStatus", error);
    return { status: "error" };
  }

  revalidatePath(CALENDAR_AREA, "layout");
  return { status: "saved" };
}

/** Nota interna dello staff (SPEC §3.6): vuota la elimina. */
export async function saveStaffNote(
  _previous: CalendarRowState,
  formData: FormData,
): Promise<CalendarRowState> {
  await requireRole(["barber", "admin"]);
  const parsed = staffNoteSchema.safeParse({
    bookingId: text(formData, "bookingId"),
    note: text(formData, "note"),
  });
  if (!parsed.success) return { status: "invalid" };

  const { bookingId, note } = parsed.data;
  try {
    const supabase = await createClient();
    // Prenotazione non visibile all'utente (RLS): errore, mai "salvato" (il delete toccherebbe 0 righe).
    const { data: booking } = await supabase.from("bookings").select("id").eq("id", bookingId).maybeSingle();
    if (!booking) return { status: "forbidden" };

    const { error } =
      note === null
        ? await supabase.from("booking_staff_notes").delete().eq("booking_id", bookingId)
        : await supabase.from("booking_staff_notes").upsert({ booking_id: bookingId, note });
    if (error) return { status: calendarErrorCode(error) };
  } catch (error) {
    console.error("saveStaffNote", error);
    return { status: "error" };
  }

  revalidatePath(bookingDetailPath(bookingId));
  return { status: "saved" };
}

/** Ricerca cliente per la prenotazione manuale (SPEC §6.2), tramite search_customers (ADR 001). */
export async function searchCustomers(query: string): Promise<CustomerSearchResult> {
  await requireRole(["barber", "admin"]);
  const parsed = customerQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: true, matches: [], blockStatusUnknown: false };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_customers", { q: parsed.data });
  if (error) {
    console.error("searchCustomers", error.code);
    return { ok: false };
  }
  // Etichetta "Bloccato" (decisione fetta 6b): search_customers resta invariata.
  let blockedIds: Set<string> | null = new Set();
  if (data.length > 0) {
    const { data: blocked, error: blockedError } = await supabase.rpc("blocked_customer_ids", {
      p_ids: data.map((row) => row.id),
    });
    if (blockedError || !blocked) {
      console.error("blocked_customer_ids", blockedError?.code);
      blockedIds = null;
    } else {
      blockedIds = new Set(blocked);
    }
  }

  return {
    ok: true,
    matches: data.map((row) => ({
      id: row.id,
      fullName: row.full_name ?? "",
      phone: row.phone,
      blocked: blockedIds ? blockedIds.has(row.id) : null,
    })),
    blockStatusUnknown: blockedIds === null,
  };
}
