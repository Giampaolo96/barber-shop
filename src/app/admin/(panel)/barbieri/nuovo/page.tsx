import Link from "next/link";
import { BarberForm } from "@/components/admin/barber-form";
import { it } from "@/i18n/it";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function NewBarberPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data: services, error } = await supabase
    .from("services")
    .select("id, name, is_active")
    .order("sort_order")
    .order("id");
  if (error) throw new Error(`servizi non leggibili: ${error.code}`);

  return (
    <>
      <Link href="/admin/barbieri" className="text-sm underline">
        {it.admin.common.backToList}
      </Link>
      <h1 className="font-display text-4xl leading-tight">{it.admin.barbers.newTitle}</h1>
      <BarberForm
        values={{ id: null, displayName: "", bio: "", isActive: true, serviceIds: [] }}
        services={services.map((service) => ({ id: service.id, name: service.name, isActive: service.is_active }))}
      />
    </>
  );
}
