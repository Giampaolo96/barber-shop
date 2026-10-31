const CALENDAR_DETAIL_PATH = "/admin/calendario";

const isUnder = (pathname: string, href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

/**
 * Voce del menu admin da accendere: quella con il percorso più lungo che contiene `pathname`, a
 * segmenti interi. `/admin` è solo il calendario, che ha le sottopagine in `/admin/calendario`.
 */
export function activeSection(
  pathname: string,
  sections: ReadonlyArray<{ slug: string; href: string }>,
): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const home = sections.find((section) => section.href === "/admin");
  if (home && (path === home.href || isUnder(path, CALENDAR_DETAIL_PATH))) return home.slug;
  const matches = sections.filter((section) => section !== home && isUnder(path, section.href));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.slug ?? null;
}
