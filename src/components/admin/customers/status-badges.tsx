import { it } from "@/i18n/it";
import { BlockedBadge } from "./blocked-badge";
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
      {status.manual && <BlockedBadge>{t.blockedByAdmin}</BlockedBadge>}
      {status.noShow && (
        <BlockedBadge>{fillText(t.blockedByNoShow, { count: customer.noShowCount, threshold })}</BlockedBadge>
      )}
    </span>
  );
}
