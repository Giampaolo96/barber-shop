"use server";

// Server action della sezione Clienti (SPEC §6.7), solo admin. Scrivono con il client della
// sessione: le regole le applica comunque il database (RLS, guardie su profiles,
// reset_no_show_count). Bloccare non cancella prenotazioni né chiude la sessione: impedisce
// solo la prenotazione online (ADR 007).
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";
import { CUSTOMERS_PATH } from "./paths";
import { customerIdSchema, setCustomerBlockedSchema } from "./schemas";

export type CustomerActionState = { status: "idle" | "saved" | "invalid" | "forbidden" | "error" };

/** Errori del database: 42501 permesso negato, il resto (P0002 cliente non trovato...) errore. */
const failure = (code: string | undefined): CustomerActionState => ({
  status: code === "42501" ? "forbidden" : "error",
});

/** Blocco manuale (`is_blocked`); lo staff si blocca dalla scheda barbiere, mai da qui. */
export async function setCustomerBlocked(
  _previous: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  await requireRole(["admin"]);
  const parsed = setCustomerBlockedSchema.safeParse({
    customerId: formData.get("customerId"),
    blocked: formData.get("blocked"),
  });
  if (!parsed.success) return { status: "invalid" };
  const { customerId, blocked } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ is_blocked: blocked })
    .eq("id", customerId)
    .eq("role", "customer")
    .select("id");
  if (error) return failure(error.code);
  if (!data || data.length !== 1) return { status: "error" };

  revalidatePath(CUSTOMERS_PATH, "layout");
  return { status: "saved" };
}

/** Azzera i no-show (toglie il blocco automatico): data e autore li registra il database. */
export async function resetNoShows(
  _previous: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  await requireRole(["admin"]);
  const parsed = customerIdSchema.safeParse(formData.get("customerId"));
  if (!parsed.success) return { status: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_no_show_count", { p_customer_id: parsed.data });
  if (error) return failure(error.code);

  revalidatePath(CUSTOMERS_PATH, "layout");
  return { status: "saved" };
}
