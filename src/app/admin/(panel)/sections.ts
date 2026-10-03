import { it } from "@/i18n/it";

/** Sezioni dell'area staff. Quelle `adminOnly` sono nascoste al barbiere e protette. */
export const ADMIN_SECTIONS = [
  { slug: "calendario", href: "/admin", label: it.admin.nav.calendar, adminOnly: false },
  { slug: "assenze", href: "/admin/assenze", label: it.admin.nav.timeOff, adminOnly: false },
  { slug: "servizi", href: "/admin/servizi", label: it.admin.nav.services, adminOnly: true },
  { slug: "barbieri", href: "/admin/barbieri", label: it.admin.nav.barbers, adminOnly: true },
  { slug: "chiusure", href: "/admin/chiusure", label: it.admin.nav.closures, adminOnly: true },
  { slug: "clienti", href: "/admin/clienti", label: it.admin.nav.customers, adminOnly: true },
  {
    slug: "impostazioni",
    href: "/admin/impostazioni",
    label: it.admin.nav.settings,
    adminOnly: true,
  },
  { slug: "statistiche", href: "/admin/statistiche", label: it.admin.nav.stats, adminOnly: true },
] as const;
