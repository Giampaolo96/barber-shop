"use server";

// Server action della prenotazione online (SPEC §5.2, §5.3). Le regole le applica il database
// (create_online_booking, cancel_own_booking) con l'utente della richiesta: mai la service role.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { COMPLETE_PROFILE_PATH } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";
import { rpcErrorCode as errorCode } from "./errors";
import { MY_BOOKINGS_PATH, confirmationPath } from "./paths";
import { cancelBookingSchema, createBookingSchema } from "./schemas";

/** `code`: codice di create_online_booking / cancel_own_booking, SQLSTATE o "invalid". */
export type BookingActionState = { status: "idle" } | { status: "error"; code: string };

export async function createBooking(
  _previous: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const user = await requireRole(["customer"]);
  if (!user.profileComplete) redirect(COMPLETE_PROFILE_PATH);

  const parsed = createBookingSchema.safeParse({
    serviceId: formData.get("serviceId"),
    barberId: formData.get("barberId"),
    startsAt: formData.get("startsAt"),
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { status: "error", code: "invalid" };
  const { serviceId, barberId, startsAt, notes } = parsed.data;

  const supabase = await createClient();
  const { data: bookingId, error } = await supabase.rpc("create_online_booking", {
    p_service_id: serviceId,
    p_barber_id: barberId === "any" ? null : barberId,
    p_starts_at: startsAt,
    p_notes: notes ?? null,
  });
  if (error) {
    const code = errorCode(error);
    if (!(error.code === "P0001" || error.code === "23P01")) console.error("createBooking", error);
    return { status: "error", code };
  }

  revalidatePath("/", "layout");
  // Schermata dedicata alla conferma (fetta 8b).
  redirect(confirmationPath(bookingId));
}

export async function cancelBooking(
  _previous: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  await requireRole(["customer"]);

  const parsed = cancelBookingSchema.safeParse({ bookingId: formData.get("bookingId") });
  if (!parsed.success) return { status: "error", code: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_own_booking", {
    p_booking_id: parsed.data.bookingId,
  });
  if (error) {
    if (error.code !== "P0001") console.error("cancelBooking", error);
    return { status: "error", code: errorCode(error) };
  }

  revalidatePath("/", "layout");
  redirect(`${MY_BOOKINGS_PATH}?esito=cancellata`);
}
