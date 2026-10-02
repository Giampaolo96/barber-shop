import { it } from "@/i18n/it";
import { requireRole } from "@/lib/auth/current-user";

// Segnaposto: il calendario arriva con la fetta 6.
export default async function AdminHomePage() {
  // I layout non si rieseguono a ogni navigazione: ogni pagina ricontrolla il ruolo.
  await requireRole(["barber", "admin"]);

  return (
    <>
      <h1 className="text-2xl font-semibold">{it.admin.nav.calendar}</h1>
      <p className="text-sm opacity-70">{it.admin.comingSoon}</p>
    </>
  );
}
