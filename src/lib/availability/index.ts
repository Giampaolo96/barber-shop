// Motore di disponibilità (SPEC §4, CLAUDE.md regola 5): funzioni pure, nessun I/O, `now` in input.
export type { Interval } from "./intervals";
export type { AvailabilityInput, BarberAvailabilityInput, BarberDaySlots, DayStatus } from "./slots";
export { availableDays, computeSlots, computeSlotsByBarber, dayStatuses, nextSlotByBarber, slotsByDay } from "./slots";
export { pickBarber } from "./assign";
