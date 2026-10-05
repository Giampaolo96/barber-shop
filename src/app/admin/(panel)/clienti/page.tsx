import Link from "next/link";
import { CustomerStatusBadges } from "@/components/admin/customers/status-badges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { requireRole } from "@/lib/auth/current-user";
import { customerPath, customersPath, CUSTOMERS_PATH } from "@/lib/customers/paths";
import { getNoShowSettings, listCustomers } from "@/lib/customers/queries";
import { CUSTOMERS_PAGE_SIZE, customerListQuerySchema } from "@/lib/customers/schemas";
import { createClient } from "@/lib/db/server";

const t = it.admin.customers;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

// Elenco dei clienti registrati con ricerca e paginazione (SPEC §6.7), solo admin.
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(["admin"]);
  const params = await searchParams;
  const { q, page } = customerListQuerySchema.parse({ q: first(params.q), pagina: first(params.pagina) });

  const supabase = await createClient();
  const [{ customers, total }, { threshold }] = await Promise.all([
    listCustomers(supabase, q, page),
    getNoShowSettings(supabase),
  ]);
  const pages = Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE));

  return (
    <>
      <h1 className="font-display text-4xl leading-tight">{it.admin.nav.customers}</h1>
      <form action={CUSTOMERS_PATH} method="get" role="search" className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="customerQuery">{t.searchLabel}</Label>
          <Input id="customerQuery" name="q" type="search" defaultValue={q} maxLength={100} className="w-72" />
        </div>
        <Button type="submit">{t.search}</Button>
        {q && (
          <Link href={CUSTOMERS_PATH} className={buttonVariants({ variant: "outline" })}>
            {t.clearSearch}
          </Link>
        )}
      </form>

      {customers.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{t.empty}</p>
          {page > 1 && (
            <Link href={customersPath({ q })} className="text-sm underline underline-offset-4">
              {t.firstPage}
            </Link>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{fillText(t.total, { count: total })}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4">{t.name}</th>
                  <th className="py-2 pr-4">{t.phone}</th>
                  <th className="py-2 pr-4">{t.email}</th>
                  <th className="py-2 pr-4">{t.noShows}</th>
                  <th className="py-2">{t.state}</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="border-b align-top">
                    <td className="py-2 pr-4">
                      <Link href={customerPath(customer.id)} className="font-medium underline underline-offset-4">
                        {customer.fullName ?? t.noName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{customer.phone ?? "—"}</td>
                    <td className="py-2 pr-4 break-all">{customer.email ?? "—"}</td>
                    <td className="py-2 pr-4">{customer.noShowCount}</td>
                    <td className="py-2">
                      <CustomerStatusBadges customer={customer} threshold={threshold} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav className="flex flex-wrap items-center gap-3 text-sm">
              {page > 1 && (
                <Link href={customersPath({ q, page: page - 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t.previousPage}
                </Link>
              )}
              <span>{fillText(t.pageOf, { page, pages })}</span>
              {page < pages && (
                <Link href={customersPath({ q, page: page + 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t.nextPage}
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
