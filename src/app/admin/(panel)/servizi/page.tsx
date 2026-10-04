import Link from "next/link";
import { RowAction } from "@/components/admin/row-action";
import { buttonVariants } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { formatCents } from "@/lib/domain/money";
import { deleteService, moveService } from "@/lib/admin/service-actions";
import { fillText } from "@/lib/admin/text";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function ServicesPage() {
  await requireRole(["admin"]);
  const t = it.admin.services;

  const supabase = await createClient();
  const { data: services, error } = await supabase
    .from("services")
    .select("id, name, duration_min, price_cents, is_active")
    .order("sort_order")
    .order("id");
  if (error) throw new Error(`servizi non leggibili: ${error.code}`);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{it.admin.nav.services}</h1>
        <Link href="/admin/servizi/nuovo" className={buttonVariants()}>
          {t.new}
        </Link>
      </div>
      {services.length === 0 ? (
        <p className="text-sm opacity-70">{it.admin.common.empty}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">{t.nameLabel}</th>
              <th className="py-2">{t.durationColumn}</th>
              <th className="py-2">{t.priceColumn}</th>
              <th className="py-2">{it.admin.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service, index) => (
              <tr key={service.id} className="border-b align-top">
                <td className="py-2">
                  {service.name}
                  {!service.is_active && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">{it.admin.common.inactive}</span>
                  )}
                </td>
                <td className="py-2">{fillText(t.minutes, { count: service.duration_min })}</td>
                <td className="py-2">{formatCents(service.price_cents)}</td>
                <td className="flex flex-wrap gap-2 py-2">
                  <Link href={`/admin/servizi/${service.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    {it.admin.common.edit}
                  </Link>
                  {index > 0 && (
                    <RowAction
                      action={moveService}
                      fields={{ id: service.id, direction: "up" }}
                      label={it.admin.common.moveUp}
                      messages={{ stale: t.reorderFailed }}
                    />
                  )}
                  {index < services.length - 1 && (
                    <RowAction
                      action={moveService}
                      fields={{ id: service.id, direction: "down" }}
                      label={it.admin.common.moveDown}
                      messages={{ stale: t.reorderFailed }}
                    />
                  )}
                  <RowAction
                    action={deleteService}
                    fields={{ id: service.id }}
                    label={it.admin.common.delete}
                    confirmText={it.admin.common.confirmDelete}
                    messages={{ has_bookings: t.deleteHasBookings }}
                    variant="destructive"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
