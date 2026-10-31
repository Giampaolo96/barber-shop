import { ChevronRight } from "lucide-react";
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
import { customerBlockStatus } from "@/lib/customers/status";
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
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <Label htmlFor="customerQuery">{t.searchLabel}</Label>
          <Input id="customerQuery" name="q" type="search" defaultValue={q} maxLength={100} className="w-full sm:w-72" />
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
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4">{t.name}</th>
                  <th className="py-2 pr-4">{t.phone}</th>
                  <th className="py-2 pr-4">{t.email}</th>
                  <th className="py-2 pr-4 text-right whitespace-nowrap">{t.noShows}</th>
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
                    <td className="py-2 pr-4 whitespace-nowrap">{customer.phone ?? "—"}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{customer.email ?? "—"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{customer.noShowCount > 0 ? customer.noShowCount : "—"}</td>
                    <td className="py-2">
                      {customerBlockStatus(customer, threshold).blocked && (
                        <CustomerStatusBadges customer={customer} threshold={threshold} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/*
            Su telefono un elenco a righe invece della tabella: cinque colonne in 340 px schiacciano
            nome ed email (che andava a capo lettera per lettera). Ogni riga è un unico link alla
            scheda, alto almeno 44 px; l'email sta su una riga e si tronca (completa nella scheda e
            nel title). Lo stato compare solo se il cliente è bloccato, i no-show solo se ce ne sono e non
            sono già nell'etichetta del blocco.
            Viene dopo la tabella nel DOM: su desktop è nascosta e i test cercano il primo testo.
          */}
          <ul className="flex flex-col border-t sm:hidden" data-testid="customers-list">
            {customers.map((customer) => {
              const status = customerBlockStatus(customer, threshold);
              // Bloccato per no-show: il conteggio è già nell'etichetta ("3 su 3")
              const showNoShows = customer.noShowCount > 0 && !status.noShow;
              return (
                <li key={customer.id} className="border-b">
                  <Link
                    href={customerPath(customer.id)}
                    className="flex min-h-11 items-center gap-3 py-3 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                      <span className="truncate font-medium">{customer.fullName ?? t.noName}</span>
                      {customer.phone && <span className="text-muted-foreground tabular-nums">{customer.phone}</span>}
                      {customer.email && (
                        <span className="truncate text-muted-foreground" title={customer.email}>
                          {customer.email}
                        </span>
                      )}
                      {(status.blocked || showNoShows) && (
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          {status.blocked && <CustomerStatusBadges customer={customer} threshold={threshold} />}
                          {showNoShows && (
                            <span className="text-muted-foreground">
                              {fillText(t.noShowsCount, { count: customer.noShowCount })}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <nav className="flex flex-wrap items-center gap-3 text-sm">
              {page > 1 && (
                <Link href={customersPath({ q, page: page - 1 })} className={buttonVariants({ variant: "outline" })}>
                  {t.previousPage}
                </Link>
              )}
              <span>{fillText(t.pageOf, { page, pages })}</span>
              {page < pages && (
                <Link href={customersPath({ q, page: page + 1 })} className={buttonVariants({ variant: "outline" })}>
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
