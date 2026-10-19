// Regressione della prova su iPhone (fetta 8, scritta durante la correzione, non da spec-qa): la
// pagina offline è HTML statico senza JavaScript dell'app. Una pagina Next offline si idratava,
// cercava script assenti dalla cache e finiva nella schermata d'errore di Next.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-variable", style: { fontFamily: "font" } });
  return { Bodoni_Moda: font, Hanken_Grotesk: font };
});

const offlineHtml = async (): Promise<string> => {
  const { GET } = await import("@/app/offline/route");
  const response = GET();
  expect(response.headers.get("content-type")).toMatch(/^text\/html/);
  return response.text();
};

describe("/offline: HTML statico", () => {
  test("documento completo in italiano, con titolo, testo e Riprova che ricarica", async () => {
    const { it } = await import("@/i18n/it");
    const html = await offlineHtml();
    expect(html).toMatch(/^<!doctype html>\s*<html lang="it">/);
    expect(html).toContain(`<h1>${it.offline.title}</h1>`);
    expect(html).toContain(it.offline.body);
    expect(html).toMatch(/<button type="button" onclick="location\.reload\(\)">Riprova<\/button>/);
  });

  test("nessuno script dell'app, nessun file esterno da caricare", async () => {
    const html = await offlineHtml();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/_next\//);
    expect(html).not.toMatch(/<link\b/i);
  });

  test("i colori sono i token del tema attivo, copiati dal suo theme.css", async () => {
    const { themeName } = await import("@/themes/active");
    const css = readFileSync(resolve(ROOT, "src/themes", themeName, "theme.css"), "utf8");
    const root = css.match(/:root\s*\{[^}]*\}/)?.[0];
    expect(root, `blocco :root in src/themes/${themeName}/theme.css`).toBeTruthy();
    const html = await offlineHtml();
    expect(html).toContain(root);
    // Fuori dal blocco del tema nessun colore letterale: solo var(--…)
    const rest = html.replace(root ?? "", "").replace(/<meta name="theme-color"[^>]*>/, "");
    expect(rest).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|oklch\(/i);
  });

  // Tema neon (approvato dall'utente): active.ts esporta il tema attivo e ogni tema importa il proprio CSS.
  test("themeName è il tema che active.ts esporta, e quel tema importa il proprio theme.css", async () => {
    const { themeName } = await import("@/themes/active");
    const active = readFileSync(resolve(ROOT, "src/themes/active.ts"), "utf8");
    expect(active).toMatch(new RegExp(`^export \\* from "\\./${themeName}";`, "m"));
    const index = readFileSync(resolve(ROOT, "src/themes", themeName, "index.ts"), "utf8");
    expect(index).toMatch(/^import "\.\/theme\.css";/m);
    expect(index).toMatch(new RegExp(`^export const themeName = "${themeName}";`, "m"));
  });
});
