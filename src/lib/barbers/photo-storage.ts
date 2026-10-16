import "server-only";
import type { createClient } from "@/lib/db/server";
import { BARBER_PHOTOS_BUCKET, isBarberPhotoPath } from "./photo";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Cancella il ritratto di un barbiere dal bucket, solo se il percorso è nella sua cartella.
 * Un errore lascia un file orfano ma non blocca l'azione che lo chiama (ADR 011).
 */
export async function removePhotoFile(supabase: ServerClient, barberId: string, path: string): Promise<void> {
  if (!isBarberPhotoPath(barberId, path)) {
    console.error("removePhotoFile: percorso inatteso", path);
    return;
  }
  const { error } = await supabase.storage.from(BARBER_PHOTOS_BUCKET).remove([path]);
  if (error) console.error("removePhotoFile", path, error);
}
