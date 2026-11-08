// Tipi del database usati dai client: quelli generati (types.ts, da non modificare a mano) con le
// correzioni che il generatore non sa esprimere. availability_inputs e availability_inputs_json:
// p_barber_id null = qualsiasi barbiere, barber_id null sulle chiusure. create_online_booking:
// p_barber_id null = "Nessuna preferenza", p_notes facoltativa. bookings: in insert i campi che calcola il trigger
// bookings_before_write (ADR 001) sono facoltativi, così il codice non passa valori segnaposto.
import type { Database as Generated } from "./types";

type PublicSchema = Generated["public"];
type Functions = PublicSchema["Functions"];
type AvailabilityInputs = Functions["availability_inputs"];
type AvailabilityInputsJson = Functions["availability_inputs_json"];
type CreateOnlineBooking = Functions["create_online_booking"];
type Tables = PublicSchema["Tables"];
type Bookings = Tables["bookings"];
type ComputedBookingColumns =
  | "ends_at"
  | "duration_min"
  | "price_cents"
  | "buffer_min"
  | "blocked_until"
  | "status_changed_at";

export type Database = Omit<Generated, "public"> & {
  public: Omit<PublicSchema, "Functions" | "Tables"> & {
    Tables: Omit<Tables, "bookings"> & {
      bookings: Omit<Bookings, "Insert"> & {
        Insert: Omit<Bookings["Insert"], ComputedBookingColumns> &
          Partial<Pick<Bookings["Insert"], ComputedBookingColumns>>;
      };
    };
    Functions: Omit<Functions, "availability_inputs" | "availability_inputs_json" | "create_online_booking"> & {
      availability_inputs: {
        Args: Omit<AvailabilityInputs["Args"], "p_barber_id"> & { p_barber_id: string | null };
        Returns: (Omit<AvailabilityInputs["Returns"][number], "barber_id"> & {
          barber_id: string | null;
        })[];
      };
      availability_inputs_json: {
        Args: Omit<AvailabilityInputsJson["Args"], "p_barber_id"> & { p_barber_id: string | null };
        Returns: AvailabilityInputsJson["Returns"];
      };
      create_online_booking: {
        Args: Omit<CreateOnlineBooking["Args"], "p_barber_id" | "p_notes"> & {
          p_barber_id: string | null;
          p_notes: string | null;
        };
        Returns: CreateOnlineBooking["Returns"];
      };
    };
  };
};
