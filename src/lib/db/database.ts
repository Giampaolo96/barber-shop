// Tipi del database usati dai client: quelli generati (types.ts, da non modificare a mano) con le
// correzioni che il generatore non sa esprimere. availability_inputs: p_barber_id null =
// qualsiasi barbiere, barber_id null sulle chiusure.
import type { Database as Generated } from "./types";

type PublicSchema = Generated["public"];
type Functions = PublicSchema["Functions"];
type AvailabilityInputs = Functions["availability_inputs"];

export type Database = Omit<Generated, "public"> & {
  public: Omit<PublicSchema, "Functions"> & {
    Functions: Omit<Functions, "availability_inputs"> & {
      availability_inputs: {
        Args: Omit<AvailabilityInputs["Args"], "p_barber_id"> & { p_barber_id: string | null };
        Returns: (Omit<AvailabilityInputs["Returns"][number], "barber_id"> & {
          barber_id: string | null;
        })[];
      };
    };
  };
};
