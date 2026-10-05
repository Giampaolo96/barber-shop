import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { ADMIN_PATH } from "@/lib/auth/access";

// Il calendario sta in /admin: questo percorso (voce "calendario" delle sezioni) ci rimanda.
export default async function CalendarIndexPage() {
  await requireRole(["barber", "admin"]);
  redirect(ADMIN_PATH);
}
