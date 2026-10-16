// Codifica del ritratto nel browser (fetta 8d), senza DOM: `encode` avvolge canvas.toBlob.
// Safari iOS non produce WebP e restituisce in silenzio un PNG: in quel caso si ripiega sul
// JPEG, che il server accetta e ricodifica comunque in WebP.
export const PORTRAIT_SIZE = 512;

const QUALITY = 0.85;

export type PortraitEncoder = (type: "image/webp" | "image/jpeg", quality: number) => Promise<Blob | null>;

export async function encodePortrait(encode: PortraitEncoder): Promise<Blob | null> {
  const webp = await encode("image/webp", QUALITY);
  if (webp?.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg", QUALITY);
  return jpeg?.type === "image/jpeg" ? jpeg : null;
}
