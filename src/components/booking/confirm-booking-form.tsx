"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { createBooking, type BookingActionState } from "@/lib/booking/actions";
import { bookingErrorMessage } from "@/lib/booking/errors";
import { NOTES_MAX_LENGTH } from "@/lib/booking/schemas";

/** Errori per cui ha senso tornare alla scelta dell'orario. */
const SLOT_ERRORS = new Set([
  "taken",
  "23P01",
  "too_soon",
  "too_far",
  "not_aligned",
  "outside_hours",
  "time_off",
  "closed",
  "barber_unavailable",
  "customer_overlap",
]);

const initialState: BookingActionState = { status: "idle" };

export function ConfirmBookingForm({
  serviceId,
  barberId,
  startsAt,
  changeTimeHref,
}: {
  serviceId: string;
  barberId: string;
  startsAt: string;
  changeTimeHref: string;
}) {
  const [state, formAction, pending] = useActionState(createBooking, initialState);
  const t = it.booking.summary;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="serviceId" value={serviceId} />
      <input type="hidden" name="barberId" value={barberId} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">{t.notesLabel}</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={NOTES_MAX_LENGTH}
          className="rounded-lg border bg-transparent px-3 py-2 text-base"
        />
      </div>
      {state.status === "error" && (
        <div role="alert" className="flex flex-col gap-2 text-destructive">
          <p>{bookingErrorMessage(state.code)}</p>
          {SLOT_ERRORS.has(state.code) && (
            <Link href={changeTimeHref} className="inline-flex h-11 items-center font-medium underline">
              {t.changeTime}
            </Link>
          )}
        </div>
      )}
      <Button type="submit" disabled={pending} className="h-12 text-base">
        {t.confirm}
      </Button>
    </form>
  );
}
