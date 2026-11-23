import { cookies } from "next/headers";
import { ACCOUNT_DELETED_COOKIE } from "@/lib/auth/account-deleted-flash";

// Cancella il messaggio usa e getta dopo la prima lettura (fetta 9b). Eccezione a requireRole
// (CLAUDE.md – Sicurezza, ADR 016): dopo l'eliminazione non c'è più una sessione, e togliere il
// cookie non espone né modifica dati.
export async function DELETE(): Promise<Response> {
  (await cookies()).delete(ACCOUNT_DELETED_COOKIE);
  return new Response(null, { status: 204 });
}
