import Link from "next/link";
import { RowAction } from "@/components/admin/row-action";
import { buttonVariants } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { deleteBarber } from "@/lib/admin/barber-actions";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function BarbersPage() {
  await requireRole(["admin"]);
  const t = it.admin.barbers;

  const supabase = await createClient();
  // Colonne esplicite: profile_id non è leggibile (grant di colonna, ADR 001).
  const { data: barbers, error } = await supabase
    .from("barbers")
    .select("id, display_name, is_active")
    .order("display_name");
  if (error) throw new Error(`barbieri non leggibili: ${error.code}`);

  const link = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-4xl leading-tight">{it.admin.nav.barbers}</h1>
        <Link href="/admin/barbieri/nuovo" className={buttonVariants()}>
          {t.new}
        </Link>
      </div>
      {barbers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{it.admin.common.empty}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">{t.displayNameLabel}</th>
              <th className="py-2">{it.admin.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {barbers.map((barber) => (
              <tr key={barber.id} className="border-b align-top">
                <td className="py-2">
                  {barber.display_name}
                  {!barber.is_active && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">{it.admin.common.inactive}</span>
                  )}
                </td>
                <td className="flex flex-wrap gap-2 py-2">
                  <Link href={`/admin/barbieri/${barber.id}`} className={link}>
                    {it.admin.common.edit}
                  </Link>
                  <Link href={`/admin/barbieri/${barber.id}/orari`} className={link}>
                    {t.hours}
                  </Link>
                  <Link href={`/admin/barbieri/${barber.id}/assenze`} className={link}>
                    {t.timeOff}
                  </Link>
                  <RowAction
                    action={deleteBarber}
                    fields={{ id: barber.id }}
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
