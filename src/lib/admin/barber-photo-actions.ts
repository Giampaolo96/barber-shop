"use server";

// Ritratto del barbiere (fetta 8d, ADR 011): caricamento e rimozione da Admin → Barbieri.
// Si usa il client dell'utente, così la RLS del bucket vale anche qui: scrive solo l'admin.
// Il percorso lo genera sempre il server; un percorso mandato dal client si ignora.
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { BARBER_PHOTOS_BUCKET, newBarberPhotoPath } from "@/lib/barbers/photo";
import { removePhotoFile } from "@/lib/barbers/photo-storage";
import { toPortraitWebp } from "@/lib/barbers/portrait-image";
import { createClient } from "@/lib/db/server";
import { PORTRAIT_MAX_BYTES, barberIdSchema, barberPhotoSchema } from "./schemas";

export type BarberPhotoState = { status: "idle" | "saved" | "invalid" | "too_large" | "not_image" | "error" };
export type BarberPhotoRemoveState = { status: "idle" | "ok" | "invalid" | "error" };

const BARBERS_PATH = "/admin/barbieri";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

const currentPhotoPath = async (
  supabase: ServerClient,
  barberId: string,
): Promise<{ found: boolean; path: string | null } | null> => {
  const { data, error } = await supabase
    .from("barbers")
    .select("id, photo_path")
    .eq("id", barberId)
    .maybeSingle();
  if (error) return null;
  return { found: data !== null, path: data?.photo_path ?? null };
};

export async function uploadBarberPhoto(
  _previous: BarberPhotoState,
  formData: FormData,
): Promise<BarberPhotoState> {
  await requireRole(["admin"]);

  const parsed = barberPhotoSchema.safeParse({
    barberId: formData.get("barberId"),
    photo: formData.get("photo"),
  });
  if (!parsed.success) return { status: "invalid" };
  const { barberId, photo } = parsed.data;
  if (photo.size > PORTRAIT_MAX_BYTES) return { status: "too_large" };

  const supabase = await createClient();
  const current = await currentPhotoPath(supabase, barberId);
  if (!current?.found) return { status: "error" };

  const portrait = await toPortraitWebp(Buffer.from(await photo.arrayBuffer()));
  if (!portrait) return { status: "not_image" };

  const path = newBarberPhotoPath(barberId);
  const { error: uploadError } = await supabase.storage
    .from(BARBER_PHOTOS_BUCKET)
    .upload(path, portrait, { contentType: "image/webp", upsert: false });
  if (uploadError) {
    console.error("uploadBarberPhoto upload", uploadError);
    return { status: "error" };
  }

  const { data: updated, error } = await supabase
    .from("barbers")
    .update({ photo_path: path })
    .eq("id", barberId)
    .select("id");
  if (error || updated.length !== 1) {
    await removePhotoFile(supabase, barberId, path);
    return { status: "error" };
  }

  if (current.path) await removePhotoFile(supabase, barberId, current.path);
  revalidatePath(BARBERS_PATH, "layout");
  return { status: "saved" };
}

export async function removeBarberPhoto(
  _previous: BarberPhotoRemoveState,
  formData: FormData,
): Promise<BarberPhotoRemoveState> {
  await requireRole(["admin"]);

  const parsed = barberIdSchema.safeParse({ barberId: formData.get("barberId") });
  if (!parsed.success) return { status: "invalid" };
  const { barberId } = parsed.data;

  const supabase = await createClient();
  const current = await currentPhotoPath(supabase, barberId);
  if (!current?.found) return { status: "error" };
  if (!current.path) return { status: "ok" };

  // Prima la riga, poi il file: il DB non punta mai a un file che non c'è.
  const { data: updated, error } = await supabase
    .from("barbers")
    .update({ photo_path: null })
    .eq("id", barberId)
    .select("id");
  if (error || updated.length !== 1) return { status: "error" };

  await removePhotoFile(supabase, barberId, current.path);
  revalidatePath(BARBERS_PATH, "layout");
  return { status: "ok" };
}
