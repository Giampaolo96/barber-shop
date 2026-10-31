import Link from "next/link";
import { notFound } from "next/navigation";
import { PeriodForm } from "@/components/admin/period-form";
import { periodFormValues } from "@/components/admin/period-table";
import { it } from "@/i18n/it";
import { getShopTimezone } from "@/lib/admin/queries";
import { isUuid } from "@/lib/admin/schemas";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function EditClosurePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [{ data: row }, tz] = await Promise.all([
    supabase.from("shop_closures").select("id, starts_at, ends_at, reason").eq("id", id).maybeSingle(),
    getShopTimezone(supabase),
  ]);
  if (!row) notFound();

  return (
    <>
      <Link href="/admin/chiusure" className="inline-flex min-h-11 w-fit items-center text-sm underline">
        {it.admin.common.backToList}
      </Link>
      <h1 className="font-display text-4xl leading-tight">{it.admin.period.editTitle}</h1>
      <PeriodForm kind="closure" values={periodFormValues(row, tz)} />
    </>
  );
}
