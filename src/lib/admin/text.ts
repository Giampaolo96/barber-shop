// Formattazione dei testi dell'area admin: logica pura, usabile anche nei componenti client.

/** `YYYY-MM-DD` → `gg/mm/aaaa`. */
export function formatItDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

/** Sostituisce i segnaposto `{nome}` di un testo di `it.ts`. */
export function fillText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Testo al singolare (count = 1) o al plurale, con `{count}` sostituito. */
export function countText(count: number, one: string, other: string): string {
  return fillText(count === 1 ? one : other, { count });
}
