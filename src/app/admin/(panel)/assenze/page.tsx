import { EMPTY_PERIOD, PeriodForm } from "@/components/admin/period-form";
import { PeriodTable } from "@/components/admin/period-table";
import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { deleteTimeOff } from "@/lib/admin/period-actions";
import { ALL_BARBERS, resolveBarberFilter, sortPeriodsForList } from "@/lib/admin/periods";
import { getOwnBarberId, getShopTimezone } from "@/lib/admin/queries";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

const TIME_OFF_COLUMNS = "id, barber_id, starts_at, ends_at, reason";

/**
 * Assenze (SPEC §2, §6.5). Il barbiere vede e gestisce solo le proprie. L'admin vede quelle di
 * tutti i barbieri, con un filtro che parte dalla sua scheda se è anche barbiere, e inserisce
 * un'assenza scegliendo il barbiere.
 */
export default async function TimeOffPage({
  searchParams,
}: {
  searchParams: Promise<{ barbiere?: string }>;
}) {
  const user = await requireRole(["barber", "admin"]);

  const supabase = await createClient();
  const [ownBarberId, tz] = await Promise.all([getOwnBarberId(supabase), getShopTimezone(supabase)]);
  const now = new Date();

  if (user.role !== "admin") {
    if (!ownBarberId) {
      return (
        <>
          <h1 className="text-2xl font-semibold">{it.admin.nav.timeOff}</h1>
          <p className="text-sm opacity-70">{it.admin.timeOff.noBarber}</p>
        </>
      );
    }
    const { data, error } = await supabase
      .from("time_off")
      .select(TIME_OFF_COLUMNS)
      .eq("barber_id", ownBarberId);
    if (error) throw new Error(`assenze non leggibili: ${error.code}`);

    return (
      <>
        <h1 className="text-2xl font-semibold">{it.admin.nav.timeOff}</h1>
        <h2 className="text-lg font-semibold">{it.admin.period.newTitle}</h2>
        <PeriodForm kind="timeOff" values={EMPTY_PERIOD} />
        <PeriodTable
          rows={sortPeriodsForList(data, now)}
          tz={tz}
          editHref={(id) => `/admin/assenze/${id}`}
          deleteAction={deleteTimeOff}
        />
      </>
    );
  }

  // Admin: colonne esplicite su barbers (grant di colonna, ADR 001).
  const { data: barbers, error: barbersError } = await supabase
    .from("barbers")
    .select("id, display_name")
    .order("display_name");
  if (barbersError) throw new Error(`barbieri non leggibili: ${barbersError.code}`);

  const { barbiere } = await searchParams;
  const selected = resolveBarberFilter(
    barbiere,
    ownBarberId,
    barbers.map((barber) => barber.id),
  );

  let query = supabase.from("time_off").select(TIME_OFF_COLUMNS);
  if (selected) query = query.eq("barber_id", selected);
  const { data: rows, error } = await query;
  if (error) throw new Error(`assenze non leggibili: ${error.code}`);

  const t = it.admin.timeOff;
  const barberNames = Object.fromEntries(barbers.map((barber) => [barber.id, barber.display_name]));

  return (
    <>
      <h1 className="text-2xl font-semibold">{it.admin.nav.timeOff}</h1>
      <h2 className="text-lg font-semibold">{it.admin.period.newTitle}</h2>
      {barbers.length === 0 ? (
        <p className="text-sm opacity-70">{t.noBarbers}</p>
      ) : (
        <PeriodForm
          // Il modulo riparte dal barbiere del filtro quando il filtro cambia.
          key={selected ?? ALL_BARBERS}
          kind="timeOff"
          values={EMPTY_PERIOD}
          barberId={selected ?? ownBarberId ?? undefined}
          barbers={barbers.map((barber) => ({ id: barber.id, name: barber.display_name }))}
        />
      )}
      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="barbiere" className="text-sm font-medium">
            {t.filterLabel}
          </label>
          <select
            id="barbiere"
            name="barbiere"
            defaultValue={selected ?? ALL_BARBERS}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value={ALL_BARBERS}>{t.allBarbers}</option>
            {barbers.map((barber) => (
              <option key={barber.id} value={barber.id}>
                {barber.display_name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          {t.filter}
        </Button>
      </form>
      <PeriodTable
        rows={sortPeriodsForList(rows, now)}
        tz={tz}
        editHref={(id) => `/admin/assenze/${id}`}
        deleteAction={deleteTimeOff}
        barberNames={barberNames}
      />
    </>
  );
}
