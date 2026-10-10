import { ImageResponse } from "next/og";
import { APP_ICON_SIZES } from "@/lib/pwa/icons";
import { appIdentity } from "@/themes/active";

// Icone del manifest (/icon/192, /icon/512), pubbliche e senza dati (ADR 009).
export function generateImageMetadata() {
  return APP_ICON_SIZES.map((size) => ({
    id: String(size),
    size: { width: size, height: size },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const size = Number(await id);
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element -- next/og disegna solo <img>
    <img src={appIdentity.iconDataUri} width={size} height={size} alt="" />,
    { width: size, height: size },
  );
}
