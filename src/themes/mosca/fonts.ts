// Font del tema "Mosca", self-hosted da next/font: i file si scaricano al build e li serve l'app,
// nessuna richiesta a Google a runtime. Bodoni Moda per titoli, nome e numeri grandi; Hanken
// Grotesk per tutto il resto.
import { Bodoni_Moda, Hanken_Grotesk } from "next/font/google";

const display = Bodoni_Moda({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--theme-font-display",
});

const body = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--theme-font-body",
});

/** Classi da mettere su <html>: definiscono le variabili dei font usate dai token. */
export const fontVariables = `${display.variable} ${body.variable}`;
