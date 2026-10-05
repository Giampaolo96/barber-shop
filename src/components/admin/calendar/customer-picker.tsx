"use client";

import { useEffect, useState } from "react";
import { BlockedBadge } from "@/components/admin/customers/blocked-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { type CustomerSearchResult, searchCustomers } from "@/lib/calendar/actions";

const t = it.admin.calendar.form;
const MIN_QUERY = 3;

/** Ricerca di un cliente registrato (SPEC §6.2): l'id scelto viaggia in `customerId`. */
export function CustomerPicker({ initial }: { initial: { id: string; label: string } | null }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; result: CustomerSearchResult } | null>(null);
  const [selected, setSelected] = useState(initial);
  const searchable = query.trim().length >= MIN_QUERY;

  useEffect(() => {
    if (!searchable) return;
    let current = true;
    const timer = setTimeout(() => {
      searchCustomers(query)
        .catch((): CustomerSearchResult => ({ ok: false }))
        .then((result) => {
          if (current) setResults({ query, result });
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, searchable]);

  // Senza risultato per la ricerca attuale la ricerca è in corso.
  const result = searchable && results?.query === query ? results.result : null;
  const searching = searchable && result === null;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="customerSearch">{t.customerSearchLabel}</Label>
      <Input
        id="customerSearch"
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-describedby="customerSearchHint"
        aria-busy={searching}
      />
      <p id="customerSearchHint" className="text-xs opacity-70">
        {t.customerSearchHint}
      </p>
      {searching && (
        <p role="status" className="text-sm opacity-70">
          {t.searching}
        </p>
      )}
      {result && !result.ok && (
        <p role="alert" className="text-sm text-destructive">
          {t.searchError}
        </p>
      )}
      {result?.ok && result.matches.length === 0 && <p className="text-sm">{t.noCustomers}</p>}
      {result?.ok && result.blockStatusUnknown && result.matches.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          {t.customerBlockUnknown}
        </p>
      )}
      {result?.ok && result.matches.length > 0 && (
        <ul className="flex flex-col gap-1">
          {result.matches.map((match) => {
            const label = [match.fullName, match.phone].filter(Boolean).join(" · ");
            return (
              <li key={match.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {label}
                  {match.blocked && (
                    <span className="ml-2">
                      <BlockedBadge>{t.customerBlocked}</BlockedBadge>
                    </span>
                  )}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setSelected({ id: match.id, label })}
                >
                  {t.chooseCustomer}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {selected && (
        <p role="status" className="text-sm font-medium">
          {t.selectedCustomer.replace("{name}", selected.label)}
        </p>
      )}
      <input type="hidden" name="customerId" value={selected?.id ?? ""} />
      <input type="hidden" name="customerLabel" value={selected?.label ?? ""} />
    </div>
  );
}
