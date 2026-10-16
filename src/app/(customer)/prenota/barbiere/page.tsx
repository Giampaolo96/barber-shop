import { redirect } from "next/navigation";
import { legacyWhenUrl } from "@/lib/booking/paths";

// Vecchio passo del flusso a 4 schermate: porta a "Quando?" mantenendo servizio, barbiere e giorno
// validi (SPEC §5.2, fetta 8e). Login e controlli li fa la pagina di destinazione.
export default async function LegacyStepPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  redirect(
    legacyWhenUrl({
      servizio: first(params.servizio),
      barbiere: first(params.barbiere),
      giorno: first(params.giorno),
    }),
  );
}
