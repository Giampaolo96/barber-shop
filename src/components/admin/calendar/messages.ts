// Testi del calendario per codici di avviso e d'errore (SPEC §9: tutto da it.ts).
import { it } from "@/i18n/it";
import type { WarningCode } from "@/lib/calendar/warnings";

const t = it.admin.calendar;

export const WARNING_TEXT: Record<WarningCode, string> = {
  outside_hours: t.warnings.outsideHours,
  time_off: t.warnings.timeOff,
  closure: t.warnings.closure,
  past: t.warnings.past,
};

/** Esiti d'errore delle azioni del calendario. */
export const CALENDAR_ERROR_TEXT: Partial<Record<string, string>> = {
  barber_busy: t.errors.barberBusy,
  customer_busy: t.errors.customerBusy,
  not_enabled: t.errors.notEnabled,
  forbidden: t.errors.forbidden,
  invalid: it.admin.common.invalid,
  error: it.admin.common.error,
};
