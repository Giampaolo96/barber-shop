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
      <h1 className="font-display text-4xl leading-tight">{section.label}</h1>
      <p className="text-sm text-muted-foreground">{it.admin.comingSoon}</p>
    </>
  );
}
