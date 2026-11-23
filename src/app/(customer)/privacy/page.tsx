import { PrivacyPolicyText } from "@/content/privacy-policy";
import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { createClient } from "@/lib/db/server";

const t = it.privacy;

// Informativa privacy (fetta 9b): pagina pubblica, anche senza login. La versione è quella corrente
// di shop_settings, la stessa che il cliente accetta.
export default async function PrivacyPage() {
  const supabase = await createClient();
  const { data: settings } = await supabase.from("shop_settings").select("privacy_policy_version").maybeSingle();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="font-display text-4xl leading-tight">{t.title}</h1>
      {settings && (
        <p className="text-sm text-muted-foreground">{fillText(t.version, { version: settings.privacy_policy_version })}</p>
      )}
      <PrivacyPolicyText />
    </main>
  );
}
