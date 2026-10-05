"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { type CustomerMatch, searchCustomers } from "@/lib/calendar/actions";

const t = it.admin.calendar.form;
const MIN_QUERY = 3;

/** Ricerca di un cliente registrato (SPEC §6.2): l'id scelto viaggia in `customerId`. */
export function CustomerPicker({ initial }: { initial: { id: string; label: string } | null }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; matches: CustomerMatch[] } | null>(null);
  const [selected, setSelected] = useState(initial);
  const searchable = query.trim().length >= MIN_QUERY;

  useEffect(() => {
    if (!searchable) return;
    let current = true;
    const timer = setTimeout(() => {
      void searchCustomers(query).then((matches) => {
        if (current) setResults({ query, matches });
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, searchable]);

  const matches = searchable && results?.query === query ? results.matches : null;

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
      />
      <p id="customerSearchHint" className="text-xs opacity-70">
        {t.customerSearchHint}
      </p>
      {matches && matches.length === 0 && <p className="text-sm">{t.noCustomers}</p>}
      {matches && matches.length > 0 && (
        <ul className="flex flex-col gap-1">
          {matches.map((match) => {
            const label = [match.fullName, match.phone].filter(Boolean).join(" · ");
            return (
              <li key={match.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{label}</span>
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
