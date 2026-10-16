import "server-only";
import sharp from "sharp";
import { PORTRAIT_SIZE } from "./portrait-encoding";

// Ricodifica sul server del ritratto (fetta 8d): qualunque cosa mandi il browser, nel bucket
// finisce solo un WebP 512×512 senza metadati. Il tipo dichiarato non basta: si guardano i
// primi byte e poi il formato letto da sharp, così SVG, PNG o testo rinominati non passano.
const isJpeg = (data: Buffer): boolean => data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;

// Il client manda 512×512: un limite basso evita che un file piccolo che dichiara dimensioni
// enormi esaurisca la memoria della funzione durante la decodifica.
const MAX_INPUT_PIXELS = 4096 * 4096;

const isWebp = (data: Buffer): boolean =>
  data.length > 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP";

/** WebP 512×512 ritagliato al centro, o null se il file non è un JPEG o WebP leggibile. */
export async function toPortraitWebp(data: Buffer): Promise<Buffer | null> {
  const expected = isJpeg(data) ? "jpeg" : isWebp(data) ? "webp" : null;
  if (!expected) return null;
  try {
    const image = sharp(data, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS });
    const { format } = await image.metadata();
    if (format !== expected) return null;
    return await image
      .rotate()
      .resize(PORTRAIT_SIZE, PORTRAIT_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
}
