"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { cancelBooking, type BookingActionState } from "@/lib/booking/actions";
import { bookingErrorMessage } from "@/lib/booking/errors";

const initialState: BookingActionState = { status: "idle" };

/** Cancellazione di una propria prenotazione, con conferma (SPEC §5.3). */
export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState(cancelBooking, initialState);
  const t = it.booking.list;

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.confirmCancel)) event.preventDefault();
      }}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <Button type="submit" variant="outline" disabled={pending} className="h-11 w-fit">
        {t.cancel}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {bookingErrorMessage(state.code)}
        </p>
      )}
    </form>
  );
}
