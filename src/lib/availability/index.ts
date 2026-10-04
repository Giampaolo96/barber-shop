// Motore di disponibilità (SPEC §4, CLAUDE.md regola 5): funzioni pure, nessun I/O, `now` in input.
export type { Interval } from "./intervals";
export type { AvailabilityInput, BarberAvailabilityInput } from "./slots";
export { availableDays, computeSlots, computeSlotsByBarber } from "./slots";
export { pickBarber } from "./assign";
