import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@/i18n/it";
import { appIdentity, themeName } from "@/themes/active";

// Pagina che il service worker mostra quando manca la rete (ADR 009). HTML statico generato alla
// build, senza JavaScript dell'app: una pagina Next offline si idraterebbe e cercherebbe script che
// la cache non ha, finendo nella schermata d'errore. Pubblica, senza sessione né dati.
export const dynamic = "force-static";

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Valori dei token del tema attivo (il blocco :root del suo theme.css), letti alla build. */
function themeTokens(): string {
  // Percorso dentro src/themes/: il tracing dei file del build resta limitato ai temi.
  const css = readFileSync(join(process.cwd(), "src", "themes", themeName, "theme.css"), "utf8");
  return css.match(/:root\s*\{[^}]*\}/)?.[0] ?? "";
}

function offlineHtml(): string {
  const t = it.offline;
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${escapeHtml(appIdentity.themeColor)}">
<title>${escapeHtml(t.title)}</title>
<style>
${themeTokens()}
html, body { height: 100%; margin: 0; }
body {
  background: var(--surface);
  color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
main {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1rem;
  min-height: 100%;
  max-width: 24rem;
  margin: 0 auto;
  padding: 1.5rem;
}
h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 2.25rem; font-weight: 400; line-height: 1.25; }
p { margin: 0; font-size: 0.875rem; color: var(--ink-muted); }
button {
  width: fit-content;
  min-height: 2.75rem;
  padding: 0 1rem;
  border: 1px solid var(--ink);
  border-radius: var(--radius, 0);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}
button:hover { background: var(--ink); color: var(--surface); }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(t.title)}</h1>
<p>${escapeHtml(t.body)}</p>
<button type="button" onclick="location.reload()">${escapeHtml(t.retry)}</button>
</main>
</body>
</html>
`;
}

export function GET(): Response {
  return new Response(offlineHtml(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
