// Spostamento delle prenotazioni sul calendario (SPEC §6.3, ADR 008): logica pura, senza I/O.
// Il database applica comunque le stesse regole (trigger bookings_before_write, RLS e vincoli).
import { blockPosition, type DayGrid } from "./grid";
import type { BookingStatus, StaffRole } from "./transitions";

const MINUTE = 60_000;

/**
 * Nuovo inizio dopo un trascinamento di `deltaRows` righe. Senza spostamento resta l'istante
 * salvato (anche se non allineato alla griglia); altrimenti si aggancia alla riga di arrivo,
 * partendo da quella in cui la prenotazione è disegnata. `null` fuori dalla griglia.
 */
export function dropStart(grid: DayGrid, bookingStartsAt: Date, deltaRows: number): Date | null {
  if (deltaRows === 0) return bookingStartsAt;
  const position = blockPosition(grid, {
    startsAt: bookingStartsAt,
    endsAt: new Date(bookingStartsAt.getTime() + MINUTE),
  });
  if (!position) return null;
  return grid.rows[position.row + deltaRows] ?? null;
}

export type DropTarget =
  | { kind: "none" }
  | { kind: "past"; barberId: string; startsAt: Date }
  | { kind: "move"; barberId: string; startsAt: Date };

/**
 * Destinazione di un trascinamento, la stessa per l'anteprima (mentre si trascina, anche durante
 * l'autoscroll) e per il rilascio: colonna sotto il puntatore (`overBarberId`, null fuori dalle
 * colonne → resta la propria) e riga di arrivo. `none` se non ammessa, fuori griglia o invariata;
 * `past` se l'orario di arrivo non è futuro (lo spostamento verso il passato non è ammesso).
 */
export function dropTarget(input: {
  grid: DayGrid;
  role: StaffRole;
  booking: { barberId: string; startsAt: Date };
  overBarberId: string | null;
  deltaRows: number;
  isActive: (barberId: string) => boolean;
  now: Date;
}): DropTarget {
  const { booking } = input;
  const barberId = input.overBarberId ?? booking.barberId;
  const allowed = canDropOn({
    role: input.role,
    sourceBarberId: booking.barberId,
    targetBarberId: barberId,
    targetActive: input.isActive(barberId),
  });
  const startsAt = dropStart(input.grid, booking.startsAt, input.deltaRows);
  if (!allowed || !startsAt) return { kind: "none" };
  if (barberId === booking.barberId && startsAt.getTime() === booking.startsAt.getTime()) return { kind: "none" };
  if (startsAt.getTime() <= input.now.getTime()) return { kind: "past", barberId, startsAt };
  return { kind: "move", barberId, startsAt };
}

/** Trascinabile: solo una confirmed non ancora iniziata; per il barbiere solo le proprie. */
export function canDrag(input: {
  role: StaffRole;
  status: BookingStatus;
  startsAt: Date;
  now: Date;
  isOwn: boolean;
}): boolean {
  if (input.status !== "confirmed" || input.startsAt.getTime() <= input.now.getTime()) return false;
  return input.role === "admin" || input.isOwn;
}

/**
 * Colonna di arrivo: la stessa sempre (anche di un barbiere disattivato); un'altra solo per
 * l'admin e solo se il barbiere è attivo.
 */
export function canDropOn(input: {
  role: StaffRole;
  sourceBarberId: string;
  targetBarberId: string;
  targetActive: boolean;
}): boolean {
  if (input.sourceBarberId === input.targetBarberId) return true;
  return input.role === "admin" && input.targetActive;
}
