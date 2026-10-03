"use server";

// Impostazioni del negozio (SPEC §3.1, §6.8): riga singola, solo l'admin.
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";
import { settingsSchema } from "./schemas";

export type SettingsState = { status: "idle" | "saved" | "invalid" | "error" };

const CHECK_VIOLATION = "23514";

export async function saveSettings(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireRole(["admin"]);

  const parsed = settingsSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    logoUrl: formData.get("logoUrl"),
    timezone: formData.get("timezone"),
    slotGranularityMin: formData.get("slotGranularityMin"),
    minAdvanceMin: formData.get("minAdvanceMin"),
    maxHorizonDays: formData.get("maxHorizonDays"),
    cancelLimitMin: formData.get("cancelLimitMin"),
    bufferMin: formData.get("bufferMin"),
    noShowBlockThreshold: formData.get("noShowBlockThreshold"),
    privacyPolicyVersion: formData.get("privacyPolicyVersion"),
  });
  if (!parsed.success) return { status: "invalid" };
  const settings = parsed.data;

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("shop_settings")
    .update({
      name: settings.name,
      address: settings.address,
      phone: settings.phone,
      logo_url: settings.logoUrl,
      timezone: settings.timezone,
      slot_granularity_min: settings.slotGranularityMin,
      min_advance_min: settings.minAdvanceMin,
      max_horizon_days: settings.maxHorizonDays,
      cancel_limit_min: settings.cancelLimitMin,
      buffer_min: settings.bufferMin,
      no_show_block_threshold: settings.noShowBlockThreshold,
      privacy_policy_version: settings.privacyPolicyVersion,
    })
    .eq("id", true)
    .select("id");
  // I vincoli del database (es. timezone) restano l'ultima difesa.
  if (error?.code === CHECK_VIOLATION) return { status: "invalid" };
  if (error || updated.length !== 1) return { status: "error" };

  revalidatePath("/", "layout");
  return { status: "saved" };
}
