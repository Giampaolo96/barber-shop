import { notFound } from "next/navigation";
import { it } from "@/i18n/it";
import { requireRole } from "@/lib/auth/current-user";
import { ADMIN_SECTIONS } from "../sections";

// Segnaposto delle sezioni dell'area staff, sostituiti dalle pagine vere nelle prossime fette.
export default async function AdminSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section: slug } = await params;
  const section = ADMIN_SECTIONS.find((candidate) => candidate.slug === slug);
  if (!section) notFound();
  await requireRole(section.adminOnly ? ["admin"] : ["barber", "admin"]);

  return (
    <>
      <h1 className="text-2xl font-semibold">{section.label}</h1>
      <p className="text-sm opacity-70">{it.admin.comingSoon}</p>
    </>
  );
}
