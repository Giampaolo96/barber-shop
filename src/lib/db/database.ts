// Tipi del database usati dai client: quelli generati (types.ts, da non modificare a mano) con le
// correzioni che il generatore non sa esprimere. availability_inputs: p_barber_id null =
// qualsiasi barbiere, barber_id null sulle chiusure. create_online_booking: p_barber_id null =
// "Nessuna preferenza", p_notes facoltativa.
import type { Database as Generated } from "./types";

type PublicSchema = Generated["public"];
type Functions = PublicSchema["Functions"];
type AvailabilityInputs = Functions["availability_inputs"];
type CreateOnlineBooking = Functions["create_online_booking"];

export type Database = Omit<Generated, "public"> & {
  public: Omit<PublicSchema, "Functions"> & {
    Functions: Omit<Functions, "availability_inputs" | "create_online_booking"> & {
      availability_inputs: {
        Args: Omit<AvailabilityInputs["Args"], "p_barber_id"> & { p_barber_id: string | null };
        Returns: (Omit<AvailabilityInputs["Returns"][number], "barber_id"> & {
          barber_id: string | null;
        })[];
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
