import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceForm } from "@/components/admin/service-form";
import { it } from "@/i18n/it";
import { centsToInput } from "@/lib/domain/money";
import { isUuid } from "@/lib/admin/schemas";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const { data: service } = await supabase
    .from("services")
    .select("id, name, description, duration_min, price_cents, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!service) notFound();

  return (
    <>
      <Link href="/admin/servizi" className="text-sm underline">
        {it.admin.common.backToList}
      </Link>
      <h1 className="font-display text-4xl leading-tight">{it.admin.services.editTitle}</h1>
      <ServiceForm
        values={{
          id: service.id,
          name: service.name,
          description: service.description ?? "",
          durationMin: String(service.duration_min),
          price: centsToInput(service.price_cents),
          isActive: service.is_active,
        }}
      />
    </>
  );
}
