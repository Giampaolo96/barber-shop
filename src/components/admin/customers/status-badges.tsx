import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { customerBlockStatus } from "@/lib/customers/status";

const t = it.admin.customers.status;

/** Stato per la prenotazione online: attivo, oppure una o due cause di blocco (decisione fetta 6b). */
export function CustomerStatusBadges({
  customer,
  threshold,
}: {
  customer: { isBlocked: boolean; noShowCount: number };
  threshold: number;
}) {
  const status = customerBlockStatus(customer, threshold);
  if (!status.blocked) return <span>{t.active}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {status.manual && (
        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
          {t.blockedByAdmin}
        </span>
      )}
      {status.noShow && (
        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
          {fillText(t.blockedByNoShow, { count: customer.noShowCount, threshold })}
        </span>
      )}
    </span>
  );
}
