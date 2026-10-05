import "server-only";

// Letture della sezione Clienti (SPEC §6.7), con il client della richiesta. Elenco e scheda passano
// da admin_customers / admin_customer (email da auth.users, solo admin); lo storico dalla RLS di
// bookings, che all'admin mostra tutte le prenotazioni.
import type { createClient } from "@/lib/db/server";
import type { BookingStatus } from "@/lib/calendar/transitions";
import { CUSTOMERS_PAGE_SIZE } from "./schemas";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Righe massime dello storico nella scheda (decisione fetta 6b). */
export const HISTORY_LIMIT = 100;

export type CustomerRow = {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  noShowCount: number;
  isBlocked: boolean;
};

export type CustomerDetail = CustomerRow & {
  createdAt: Date;
  noShowResetAt: Date | null;
  noShowResetBy: string | null;
};

export type CustomerBooking = {
  id: string;
  startsAt: Date;
  status: BookingStatus;
  serviceName: string;
  barberName: string;
  priceCents: number;
};

const fail = (what: string, error: { code?: string; message?: string } | null): never => {
  throw new Error(`${what} non leggibili: ${error?.code ?? ""} ${error?.message ?? ""}`.trim());
};

export async function listCustomers(
  supabase: ServerClient,
  q: string,
  page: number,
): Promise<{ customers: CustomerRow[]; total: number }> {
  const { data, error } = await supabase.rpc("admin_customers", {
    q,
    p_limit: CUSTOMERS_PAGE_SIZE,
    p_offset: (page - 1) * CUSTOMERS_PAGE_SIZE,
  });
  if (error || !data) return fail("clienti", error);
  return {
    customers: data.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      email: row.email,
      noShowCount: row.no_show_count,
      isBlocked: row.is_blocked,
    })),
    // Oltre l'ultima pagina non arrivano righe: il totale resta ignoto (0).
    total: Number(data[0]?.total_count ?? 0),
  };
}

/** Scheda del cliente; null se il profilo non esiste o non è un cliente. */
export async function getCustomer(supabase: ServerClient, id: string): Promise<CustomerDetail | null> {
  const { data, error } = await supabase.rpc("admin_customer", { p_id: id });
  if (error || !data) return fail("cliente", error);
  const row = data[0];
  if (!row) return null;

  let resetByName: string | null = null;
  if (row.no_show_reset_by) {
    const { data: author, error: authorError } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", row.no_show_reset_by)
      .maybeSingle();
    // Il nome dell'autore è solo informativo: la scheda si mostra comunque, con "—".
    if (authorError) console.error("autore dell'azzeramento non leggibile:", authorError.code);
    resetByName = author?.full_name ?? null;
  }

  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    noShowCount: row.no_show_count,
    isBlocked: row.is_blocked,
    createdAt: new Date(row.created_at),
    noShowResetAt: row.no_show_reset_at ? new Date(row.no_show_reset_at) : null,
    noShowResetBy: resetByName,
  };
}

/** Storico, prima le più recenti: una riga in più dice se ce ne sono oltre il limite. */
export async function getCustomerBookings(
  supabase: ServerClient,
  customerId: string,
): Promise<{ bookings: CustomerBooking[]; truncated: boolean }> {
  const { data, error } = await supabase
    .from("bookings")
    .select("id, starts_at, status, price_cents, barber:barbers(display_name), service:services(name)")
    .eq("customer_id", customerId)
    .order("starts_at", { ascending: false })
    .order("id")
    .limit(HISTORY_LIMIT + 1);
  if (error || !data) return fail("prenotazioni del cliente", error);
  return {
    bookings: data.slice(0, HISTORY_LIMIT).map((row) => ({
      id: row.id,
      startsAt: new Date(row.starts_at),
      status: row.status,
      serviceName: row.service?.name ?? "",
      barberName: row.barber?.display_name ?? "",
      priceCents: row.price_cents,
    })),
    truncated: data.length > HISTORY_LIMIT,
  };
}

export async function getNoShowSettings(
  supabase: ServerClient,
): Promise<{ timezone: string; threshold: number }> {
  const { data, error } = await supabase
    .from("shop_settings")
    .select("timezone, no_show_block_threshold")
    .single();
  if (error || !data) return fail("impostazioni", error);
  return { timezone: data.timezone, threshold: data.no_show_block_threshold };
}
