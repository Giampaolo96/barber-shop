import Link from "next/link";
import { RowAction } from "@/components/admin/row-action";
import { buttonVariants } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { formatCents } from "@/lib/domain/money";
import { deleteService, moveService } from "@/lib/admin/service-actions";
import { fillText } from "@/lib/admin/text";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

const t = it.admin.services;

/** Azioni di un servizio: Su e Giù hanno sempre la loro casella, così "Elimina" non si sposta. */
function ServiceActions({ id, first, last }: { id: string; first: boolean; last: boolean }) {
  return (
    <div className="grid w-fit grid-cols-[auto_3.5rem_3.5rem_auto] gap-2">
      <Link href={`/admin/servizi/${id}`} className={buttonVariants({ variant: "outline" })}>
        {it.admin.common.edit}
      </Link>
      {first ? (
        <span />
      ) : (
        <RowAction
          action={moveService}
          fields={{ id, direction: "up" }}
          label={it.admin.common.moveUp}
          messages={{ stale: t.reorderFailed }}
          size="default"
        />
      )}
      {last ? (
        <span />
      ) : (
        <RowAction
          action={moveService}
          fields={{ id, direction: "down" }}
          label={it.admin.common.moveDown}
          messages={{ stale: t.reorderFailed }}
          size="default"
        />
      )}
      <RowAction
        action={deleteService}
        fields={{ id }}
        label={it.admin.common.delete}
        confirmText={it.admin.common.confirmDelete}
        messages={{ has_bookings: t.deleteHasBookings }}
        variant="destructive-quiet"
        size="default"
      />
    </div>
  );
}

export default async function ServicesPage() {
  await requireRole(["admin"]);

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
        <h1 className="font-display text-4xl leading-tight">{it.admin.nav.services}</h1>
        <Link href="/admin/servizi/nuovo" className={buttonVariants()}>
          {t.new}
        </Link>
      </div>
      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">{it.admin.common.empty}</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4">{t.nameLabel}</th>
                  <th className="py-2 pr-4 text-right">{t.durationColumn}</th>
                  <th className="py-2 pr-8 text-right">{t.priceColumn}</th>
                  <th className="py-2">{it.admin.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service, index) => (
                  <tr key={service.id} className="border-b align-top">
                    <td className="py-2 pr-4">
                      {service.name}
                      {!service.is_active && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                          {it.admin.common.inactive}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
                      {fillText(t.minutes, { count: service.duration_min })}
                    </td>
                    <td className="py-2 pr-8 text-right whitespace-nowrap tabular-nums">
                      {formatCents(service.price_cents)}
                    </td>
                    <td className="py-2">
                      <ServiceActions id={service.id} first={index === 0} last={index === services.length - 1} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Su telefono un elenco a righe invece della tabella, come in Clienti. */}
          <ul className="flex flex-col border-t sm:hidden" data-testid="services-list">
            {services.map((service, index) => (
              <li key={service.id} className="flex flex-col gap-2 border-b py-3 text-sm">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-medium">
                    {service.name}
                    {!service.is_active && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">
                        {it.admin.common.inactive}
                      </span>
                    )}
                  </span>
                  <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {fillText(t.minutes, { count: service.duration_min })}, {formatCents(service.price_cents)}
                  </span>
                </span>
                <ServiceActions id={service.id} first={index === 0} last={index === services.length - 1} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
