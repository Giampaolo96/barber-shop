import { ImageResponse } from "next/og";
import { appIdentity } from "@/themes/active";

// Icona per la schermata Home di iOS, pubblica e senza dati (ADR 009). iOS arrotonda gli angoli.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element -- next/og disegna solo <img>
    <img src={appIdentity.iconDataUri} width={size.width} height={size.height} alt="" />,
    size,
  );
}
