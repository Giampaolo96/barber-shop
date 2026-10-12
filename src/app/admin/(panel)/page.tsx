import { CalendarToolbar } from "@/components/admin/calendar/calendar-toolbar";
import { DayGridView } from "@/components/admin/calendar/day-grid";
import { NewBookingLink } from "@/components/admin/calendar/new-booking-link";
import { WeekGridView } from "@/components/admin/calendar/week-grid";
import { it } from "@/i18n/it";
import type { CurrentUser } from "@/lib/auth/profile";
import { requireRole } from "@/lib/auth/current-user";
import { formatDayLabel } from "@/lib/booking/format";
import { weekDates } from "@/lib/calendar/grid";
import {
  type DayViewData,
  getStaffBarbers,
  loadDayView,
  loadWeekView,
  type WeekViewData,
} from "@/lib/calendar/page-data";
import { type CalendarBarber, type CalendarSettings, getCalendarSettings } from "@/lib/calendar/queries";
import { type CalendarQuery, parseCalendarQuery } from "@/lib/calendar/view";
import { createClient } from "@/lib/db/server";
import { localDateOf } from "@/lib/domain/local-time";

const t = it.admin.calendar;

type SearchParams = Record<string, string | string[] | undefined>;

type CalendarData = {
  settings: CalendarSettings;
  today: string;
  query: CalendarQuery;
  barbers: CalendarBarber[];
  ownBarberId: string | null;
  day: DayViewData | null;
  week: WeekViewData | null;
};

async function loadCalendar(user: CurrentUser, params: SearchParams): Promise<CalendarData | null> {
  try {
    const supabase = await createClient();
    const settings = await getCalendarSettings(supabase);
    const today = localDateOf(new Date(), settings.timezone);
    const query = parseCalendarQuery(params, today);
    const { barbers, ownBarberId } = await getStaffBarbers(supabase, user);
    const base = { settings, today, query, barbers, ownBarberId, day: null, week: null };
    if (barbers.length === 0) return base;
    if (query.view === "settimana") {
      return { ...base, week: await loadWeekView(supabase, settings, query, barbers, ownBarberId) };
    }
    return { ...base, day: await loadDayView(supabase, settings, query, barbers) };
  } catch (error) {
    console.error("AdminCalendarPage", error);
    return null;
  }
}

// Calendario dello staff (SPEC §6.1): vista giorno con una colonna per barbiere, vista settimana a
// griglia per un barbiere alla volta (fetta 8c). Il barbiere vede solo la propria scheda.
export default async function AdminCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // I layout non si rieseguono a ogni navigazione: ogni pagina ricontrolla il ruolo.
  const user = await requireRole(["barber", "admin"]);
  const data = await loadCalendar(user, await searchParams);

  if (!data) {
    return (
      <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">
        {t.loadError}
      </p>
    );
  }
  if (data.barbers.length === 0) {
    return <p className="text-sm">{user.role === "admin" ? t.noBarbers : t.noOwnBarber}</p>;
  }

  const { settings, today, query, week, day } = data;
  if (week) {
    const dates = weekDates(query.date);
    const weekBarberActive = data.barbers.some((barber) => barber.id === week.barberId && barber.isActive);
    return (
      <div className="flex flex-col gap-4">
        <CalendarToolbar
          query={query}
          today={today}
          title={`${formatDayLabel(dates[0])} – ${formatDayLabel(dates[6])}`}
          barbers={user.role === "admin" ? data.barbers.filter((barber) => barber.isActive) : []}
          weekBarberId={week.barberId}
          cancelledCount={week.cancelledCount}
        />
        {week.barberId && weekBarberActive && (
          <NewBookingLink barberId={week.barberId} date={dates.includes(today) ? today : dates[0]} />
        )}
        {week.barberId && week.grid ? (
          <WeekGridView
            grid={week.grid}
            days={week.days}
            barberId={week.barberId}
            barberActive={weekBarberActive}
            timezone={settings.timezone}
            today={today}
            showCancelled={query.showCancelled}
            role={user.role === "admin" ? "admin" : "barber"}
            ownBarberId={data.ownBarberId}
            now={new Date()}
          />
        ) : (
          <p className="text-sm">{t.noBarbers}</p>
        )}
      </div>
    );
  }

  if (!day) return null;
  const firstBarber = day.columns.find((column) => column.isActive)?.barberId;
  return (
    <div className="flex flex-col gap-4">
      <CalendarToolbar
        query={query}
        today={today}
        title={formatDayLabel(query.date)}
        barbers={[]}
        weekBarberId={null}
        cancelledCount={day.cancelledCount}
      />
      {firstBarber && <NewBookingLink barberId={firstBarber} date={query.date} />}
      <DayGridView
        grid={day.grid}
        date={query.date}
        timezone={settings.timezone}
        columns={day.columns}
        role={user.role === "admin" ? "admin" : "barber"}
        ownBarberId={data.ownBarberId}
        now={new Date()}
      />
    </div>
  );
}
