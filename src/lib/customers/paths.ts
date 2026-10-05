// Percorsi della sezione Clienti (solo admin).

export const CUSTOMERS_PATH = "/admin/clienti";

/** Elenco con ricerca (`q`) e pagina (`pagina`); i valori di default non compaiono nell'URL. */
export function customersPath(params: { q?: string; page?: number } = {}): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.page && params.page > 1) search.set("pagina", String(params.page));
  const query = search.toString();
  return query ? `${CUSTOMERS_PATH}?${query}` : CUSTOMERS_PATH;
}

export const customerPath = (id: string): string => `${CUSTOMERS_PATH}/${id}`;
