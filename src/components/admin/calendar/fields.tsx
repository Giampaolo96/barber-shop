import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { TIME_STEP_MIN } from "@/lib/calendar/schemas";

const t = it.admin.calendar.form;
export { selectClass } from "@/components/ui/field";
import { selectClass } from "@/components/ui/field";

export type Option = { id: string; label: string };

/** Barbiere, servizio, data e ora: comuni a nuova prenotazione e modifica. */
export function SlotFields({
  idPrefix,
  barbers,
  services,
  values,
}: {
  idPrefix: string;
  barbers: Option[];
  services: Option[];
  values: { barberId: string; serviceId: string; date: string; time: string };
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={id("barberId")}>{t.barberLabel}</Label>
        <select id={id("barberId")} name="barberId" defaultValue={values.barberId} className={selectClass}>
          {barbers.map((barber) => (
            <option key={barber.id} value={barber.id}>
              {barber.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={id("serviceId")}>{t.serviceLabel}</Label>
        <select id={id("serviceId")} name="serviceId" defaultValue={values.serviceId} className={selectClass}>
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={id("date")}>{t.dateLabel}</Label>
          <Input id={id("date")} name="date" type="date" required defaultValue={values.date} className="h-11" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={id("time")}>{t.timeLabel}</Label>
          <Input
            id={id("time")}
            name="time"
            type="time"
            step={TIME_STEP_MIN * 60}
            required
            defaultValue={values.time}
            className="h-11"
          />
        </div>
      </div>
    </>
  );
}
