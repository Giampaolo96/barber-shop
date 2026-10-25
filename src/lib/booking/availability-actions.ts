"use server";

// Disponibilità per il flusso di prenotazione (ADR 004, ADR 012). Senza requireRole: gli orari liberi
// sono pubblici e availability_inputs è eseguibile anche da anon. Input validato con Zod in
// getAvailableSlots / getAvailableDays / getWhenDay. Il rate limiting per IP è nel firewall Vercel
// (DEPLOY.md).
import {
  getAvailableDays,
  getAvailableSlots,
  getWhenDay,
  type DaysResult,
  type SlotsResult,
  type WhenDayResult,
} from "./availability";

export async function fetchAvailableSlots(args: {
  serviceId: string;
  barberId: string;
  date: string;
}): Promise<SlotsResult> {
  return getAvailableSlots(args);
}

export async function fetchAvailableDays(args: {
  serviceId: string;
  barberId: string;
  from: string;
  to: string;
}): Promise<DaysResult> {
  return getAvailableDays(args);
}

/** Orari di tutti i barbieri del servizio nel giorno scelto di "Quando?" (SPEC §5.2, fetta 8e). */
export async function fetchWhenDay(args: { serviceId: string; date: string }): Promise<WhenDayResult> {
  return getWhenDay(args);
}
