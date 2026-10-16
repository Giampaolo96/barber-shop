// Ritratti dei barbieri in Supabase Storage (fetta 8d, ADR 011). Sulla riga resta solo il
// percorso; il formato è lo stesso del check barbers_photo_path_format.
export const BARBER_PHOTOS_BUCKET = "barber-photos";

/** Percorso nuovo a ogni caricamento: la CDN non può servire la foto precedente. */
export function newBarberPhotoPath(barberId: string): string {
  return `${barberId}/${crypto.randomUUID().replaceAll("-", "")}.webp`;
}

export function isBarberPhotoPath(barberId: string, path: string): boolean {
  const [prefix, file, ...rest] = path.split("/");
  return rest.length === 0 && prefix === barberId && /^[0-9a-f]{32}\.webp$/.test(file ?? "");
}

/** URL pubblico del ritratto (bucket pubblico in lettura), null se il barbiere non ha foto. */
export function barberPhotoUrl(path: string | null): string | null {
  if (path === null) return null;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${BARBER_PHOTOS_BUCKET}/${path}`;
}
