"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/admin/form-status";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { type CalendarRowState, saveStaffNote } from "@/lib/calendar/actions";
import { CALENDAR_LIMITS } from "@/lib/calendar/schemas";
import { CALENDAR_ERROR_TEXT } from "./messages";

const initialState: CalendarRowState = { status: "idle" };

/** Nota interna dello staff (SPEC §3.6): mai visibile al cliente; vuota la elimina. */
export function StaffNoteForm({ bookingId, note }: { bookingId: string; note: string | null }) {
  const [state, formAction, pending] = useActionState(saveStaffNote, initialState);
  const error = state.status === "saved" || state.status === "idle" ? null : CALENDAR_ERROR_TEXT[state.status];

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Label htmlFor="note">{it.admin.calendar.detail.staffNoteTitle}</Label>
      <textarea
        id="note"
        name="note"
        maxLength={CALENDAR_LIMITS.staffNote}
        rows={3}
        defaultValue={note ?? ""}
        className="rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
      />
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        {it.admin.common.save}
      </Button>
      {state.status === "saved" && <FormStatus status="saved" />}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
