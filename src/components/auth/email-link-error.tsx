"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { INVALID_LINK_PATH } from "@/lib/auth/email-fallback";

/**
 * Ripiego per il template email predefinito: se Supabase rimanda con l'errore solo nel fragment
 * (#error=…, che il server non vede), si va alla pagina di accesso con il messaggio del link non
 * valido. Gli errori nella query li gestisce già il proxy.
 */
export function EmailLinkError() {
  const router = useRouter();
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has("error") || fragment.has("error_code")) router.replace(INVALID_LINK_PATH);
  }, [router]);
  return null;
}
