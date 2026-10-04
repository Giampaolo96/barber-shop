"use server";

// Disponibilità per il flusso di prenotazione (ADR 004). Senza requireRole: gli orari liberi sono
// pubblici e availability_inputs è eseguibile anche da anon. Input validato con Zod in
// getAvailableSlots / getAvailableDays. Il rate limiting per IP è nel firewall Vercel (DEPLOY.md).
import {
  getAvailableDays,
  getAvailableSlots,
  type DaysResult,
  type SlotsResult,
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
