// Destinazione dopo il login: solo percorsi relativi interni, per non fare da open redirect.

const BASE = "http://internal.invalid";

export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  // `//host` e `/\host` sono URL esterni per il browser; spazi e caratteri di controllo
  // vengono rimossi dal parser degli URL e possono nasconderli.
  if (next.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(next)) return "/";

  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE || url.pathname.startsWith("//")) return "/";
  } catch {
    return "/";
  }
  return next;
}
