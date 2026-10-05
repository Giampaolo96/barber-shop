"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import {
  createStaffAccount,
  linkStaffAccount,
  setStaffBlocked,
  unlinkStaffAccount,
} from "@/lib/admin/staff-accounts";
import type { StaffAccountState, StaffActionState } from "@/lib/admin/staff-accounts";
import { fillText } from "@/lib/admin/text";
import { selectClass } from "@/components/ui/field";

export type LinkedAccount = { profileId: string; fullName: string; isBlocked: boolean; isSelf: boolean };
export type StaffOption = { profileId: string; fullName: string };

const idleAccount: StaffAccountState = { status: "idle" };
const idleAction: StaffActionState = { status: "idle" };

const ACTION_MESSAGES: Partial<Record<StaffActionState["status"], string>> = {
  invalid: it.admin.common.invalid,
  error: it.admin.common.error,
  not_staff: it.admin.staff.notStaff,
  self: it.admin.staff.self,
  barber_has_account: it.admin.staff.hasAccount,
  account_linked: it.admin.staff.alreadyLinked,
  stale: it.admin.staff.stale,
};

const ACCOUNT_MESSAGES: Partial<Record<StaffAccountState["status"], string>> = {
  invalid: it.admin.common.invalid,
  error: it.admin.common.error,
  email_taken: it.admin.staff.emailTaken,
  barber_has_account: it.admin.staff.hasAccount,
  stale: it.admin.staff.stale,
};

/**
 * Account staff della scheda barbiere. Un solo componente per tutti gli stati, così l'esito
 * della creazione resta visibile anche dopo che la scheda risulta collegata.
 */
export function StaffAccountSection({
  barberId,
  account,
  staffWithoutCard,
}: {
  barberId: string;
  account: LinkedAccount | null;
  staffWithoutCard: StaffOption[];
}) {
  const [created, createAction, creating] = useActionState(createStaffAccount, idleAccount);
  const [blockState, blockAction, blocking] = useActionState(setStaffBlocked, idleAction);
  const [linkState, linkAction, linking] = useActionState(linkStaffAccount, idleAction);
  const [unlinkState, unlinkAction, unlinking] = useActionState(unlinkStaffAccount, idleAction);
  const t = it.admin.staff;

  const actionMessage = [blockState, linkState, unlinkState]
    .map((state) => ACTION_MESSAGES[state.status])
    .find(Boolean);
  const accountMessage = ACCOUNT_MESSAGES[created.status];

  return (
    <section className="flex max-w-lg flex-col gap-4">
      <h2 className="text-xl font-semibold">{t.title}</h2>
      {created.status === "created" && (
        <p role="status" className="text-sm font-medium">
          {t.created}
        </p>
      )}

      {account ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {fillText(t.linkedTo, { name: account.fullName })} {account.isSelf && t.you}
          </p>
          {account.isBlocked && <p className="text-sm font-medium text-destructive">{t.blocked}</p>}
          <div className="flex flex-wrap gap-2">
            {/* L'admin non blocca se stesso (decisione fetta 3). */}
            {!account.isSelf && (
              <form action={blockAction}>
                <input type="hidden" name="profileId" value={account.profileId} />
                <input type="hidden" name="blocked" value={account.isBlocked ? "false" : "true"} />
                <Button type="submit" variant={account.isBlocked ? "outline" : "destructive"} disabled={blocking}>
                  {account.isBlocked ? t.unblock : t.block}
                </Button>
              </form>
            )}
            <form action={unlinkAction}>
              <input type="hidden" name="barberId" value={barberId} />
              <Button type="submit" variant="outline" disabled={unlinking}>
                {t.unlink}
              </Button>
            </form>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t.none}</p>
          <form action={createAction} noValidate className="flex flex-col gap-4">
            <input type="hidden" name="barberId" value={barberId} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="staffEmail">{t.emailLabel}</Label>
              <Input id="staffEmail" name="email" type="email" autoComplete="off" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="staffPassword">{t.passwordLabel}</Label>
              <Input
                id="staffPassword"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="staffDisplayName">{t.displayNameLabel}</Label>
              <Input id="staffDisplayName" name="displayName" maxLength={100} required />
            </div>
            <Button type="submit" disabled={creating} className="self-start">
              {t.create}
            </Button>
          </form>

          {staffWithoutCard.length > 0 && (
            <form action={linkAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="barberId" value={barberId} />
              <div className="flex flex-col gap-2">
                <Label htmlFor="linkProfile">{t.linkLabel}</Label>
                <select
                  id="linkProfile"
                  name="profileId"
                  className={selectClass}
                >
                  {staffWithoutCard.map((option) => (
                    <option key={option.profileId} value={option.profileId}>
                      {option.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="outline" disabled={linking}>
                {t.link}
              </Button>
            </form>
          )}
        </>
      )}

      {accountMessage && (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">
          {accountMessage}
        </p>
      )}
      {actionMessage && (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">
          {actionMessage}
        </p>
      )}
    </section>
  );
}
