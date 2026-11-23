import Link from "next/link";
import { DeleteAccountForm } from "@/components/auth/delete-account-form";
import { secondaryLinkClass } from "@/components/auth/secondary-link";
import { it } from "@/i18n/it";
import { PROFILE_PATH } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/current-user";

const t = it.profile.deletion;

// Eliminazione dell'account del cliente (SPEC §8, fetta 9b): riepilogo di cosa succede, poi due passi.
// Raggiungibile anche con il consenso privacy scaduto.
export default async function DeleteAccountPage() {
  await requireRole(["customer"]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="font-display text-4xl leading-tight">{t.title}</h1>
      <p>{t.intro}</p>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        <li>{t.futureBookings}</li>
        <li>{t.pastBookings}</li>
        <li>{t.account}</li>
      </ul>
      <p className="font-medium">{t.irreversible}</p>
      <DeleteAccountForm />
      <Link href={PROFILE_PATH} className={secondaryLinkClass}>
        {t.cancel}
      </Link>
    </main>
  );
}
