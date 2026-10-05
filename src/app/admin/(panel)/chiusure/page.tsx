import { EMPTY_PERIOD, PeriodForm } from "@/components/admin/period-form";
import { PeriodTable } from "@/components/admin/period-table";
import { it } from "@/i18n/it";
import { deleteClosure } from "@/lib/admin/period-actions";
import { getShopTimezone } from "@/lib/admin/queries";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function ClosuresPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const [closuresResult, tz] = await Promise.all([
    supabase
      .from("shop_closures")
      .select("id, starts_at, ends_at, reason")
      .order("starts_at", { ascending: false }),
    getShopTimezone(supabase),
  ]);
  if (closuresResult.error) throw new Error(`chiusure non leggibili: ${closuresResult.error.code}`);

  return (
    <>
      <h1 className="font-display text-4xl leading-tight">{it.admin.nav.closures}</h1>
      <p className="text-sm text-muted-foreground">{it.admin.closures.intro}</p>
      <h2 className="text-lg font-semibold">{it.admin.period.newTitle}</h2>
      <PeriodForm kind="closure" values={EMPTY_PERIOD} />
      <PeriodTable
        rows={closuresResult.data}
        tz={tz}
        editHref={(id) => `/admin/chiusure/${id}`}
        deleteAction={deleteClosure}
      />
    </>
  );
}
