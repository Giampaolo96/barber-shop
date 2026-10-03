import { SettingsForm } from "@/components/admin/settings-form";
import { it } from "@/i18n/it";
import { SETTINGS_LIMITS, SLOT_GRANULARITY_OPTIONS } from "@/lib/admin/schemas";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function SettingsPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data: settings, error } = await supabase
    .from("shop_settings")
    .select(
      "name, address, phone, logo_url, timezone, slot_granularity_min, min_advance_min, max_horizon_days, cancel_limit_min, buffer_min, no_show_block_threshold, privacy_policy_version",
    )
    .single();
  if (error) throw new Error(`impostazioni non leggibili: ${error.code}`);

  return (
    <>
      <h1 className="text-2xl font-semibold">{it.admin.nav.settings}</h1>
      <p className="text-sm opacity-70">{it.admin.settings.intro}</p>
      <SettingsForm
        granularityOptions={SLOT_GRANULARITY_OPTIONS}
        limits={SETTINGS_LIMITS}
        values={{
          name: settings.name,
          address: settings.address ?? "",
          phone: settings.phone ?? "",
          logoUrl: settings.logo_url ?? "",
          timezone: settings.timezone,
          slotGranularityMin: settings.slot_granularity_min,
          minAdvanceMin: settings.min_advance_min,
          maxHorizonDays: settings.max_horizon_days,
          cancelLimitMin: settings.cancel_limit_min,
          bufferMin: settings.buffer_min,
          noShowBlockThreshold: settings.no_show_block_threshold,
          privacyPolicyVersion: settings.privacy_policy_version,
        }}
      />
    </>
  );
}
