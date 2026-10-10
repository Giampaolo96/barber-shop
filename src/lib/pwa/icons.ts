import "server-only";

import { appIconSvg } from "@/themes/active";

// Icone dell'app installata, generate da src/app/icon.tsx con il disegno del tema: stesso
// disegno a tutto campo per ogni misura, nella zona sicura, quindi la 512 vale anche come maskable.

export const APP_ICON_SIZES = [192, 512] as const;

export const appIconPath = (size: (typeof APP_ICON_SIZES)[number]): string => `/icon/${size}`;

/** Disegno del tema come data URI per next/og: costruito solo qui, lato server. */
export const appIconDataUri = (): string =>
  `data:image/svg+xml;base64,${Buffer.from(appIconSvg()).toString("base64")}`;
