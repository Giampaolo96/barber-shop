import Link from "next/link";
import { ServiceForm } from "@/components/admin/service-form";
import { it } from "@/i18n/it";
import { requireRole } from "@/lib/auth/current-user";

export default async function NewServicePage() {
  await requireRole(["admin"]);

  return (
    <>
      <Link href="/admin/servizi" className="inline-flex min-h-11 w-fit items-center text-sm underline">
        {it.admin.common.backToList}
      </Link>
      <h1 className="font-display text-4xl leading-tight">{it.admin.services.newTitle}</h1>
      <ServiceForm
        values={{ id: null, name: "", description: "", durationMin: "", price: "", isActive: true }}
      />
    </>
  );
}
