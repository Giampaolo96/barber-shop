"use client";

import { useEffect } from "react";
import { it } from "@/i18n/it";
import { ACCOUNT_DELETED_FLASH_PATH } from "@/lib/auth/account-deleted-flash";

/** Messaggio dopo l'eliminazione dell'account: mostrato una volta, poi il cookie si cancella. */
export function AccountDeletedNotice() {
  useEffect(() => {
    // Se la richiesta fallisce il cookie scade comunque dopo un minuto.
    fetch(ACCOUNT_DELETED_FLASH_PATH, { method: "DELETE" }).catch(() => undefined);
  }, []);

  return (
    <p role="status" className="mx-auto w-full max-w-xl border-b border-line px-4 py-3 text-sm">
      {it.home.accountDeleted}
    </p>
  );
}
