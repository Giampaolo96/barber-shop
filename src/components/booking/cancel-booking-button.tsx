"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { cancelBooking, type BookingActionState } from "@/lib/booking/actions";
import { bookingErrorText } from "@/lib/booking/errors";
import { cn } from "@/lib/utils";

const initialState: BookingActionState = { status: "idle" };

/** Cancellazione di una propria prenotazione, con conferma (SPEC §5.3). */
export function CancelBookingButton({ bookingId, buttonClassName }: { bookingId: string; buttonClassName?: string }) {
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
      <Button type="submit" variant="outline" disabled={pending} className={cn("h-11 w-fit", buttonClassName)}>
        {t.cancel}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">
          {bookingErrorText(state.code)}
        </p>
      )}
    </form>
  );
}
