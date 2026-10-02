import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { CUSTOMER_LOGIN_PATH } from "@/lib/auth/access";
import { confirmEmailLink } from "@/lib/auth/actions";
import { emailLinkSchema } from "@/lib/auth/schemas";

// Destinazione dei link nelle email. Aprire il link (GET) non consuma il token: gli scanner
// dei provider di posta lo visitano prima dell'utente. L'accesso avviene solo con il
// pulsante, che invia il token alla server action (POST).
export default async function ConfirmEmailLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const params = await searchParams;
  const parsed = emailLinkSchema.safeParse({
    tokenHash: params.token_hash,
    type: params.type,
    next: params.next,
  });
  if (!parsed.success) redirect(`${CUSTOMER_LOGIN_PATH}?errore=link`);

  const t = it.auth.confirmLink;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="text-sm opacity-70">{t.intro}</p>
      <form action={confirmEmailLink} className="flex flex-col">
        <input type="hidden" name="tokenHash" value={parsed.data.tokenHash} />
        <input type="hidden" name="type" value={parsed.data.type} />
        <input type="hidden" name="next" value={parsed.data.next ?? ""} />
        <Button type="submit" className="h-11">
          {t.submit}
        </Button>
      </form>
    </main>
  );
}
