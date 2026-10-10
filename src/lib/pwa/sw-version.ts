// Versione della cache del service worker (ADR 009): cambia a ogni deploy senza costanti da
// aggiornare a mano. next.config.ts la calcola al build e register-sw.tsx la passa a /sw.js come
// ?v=: con un URL nuovo il browser installa il nuovo worker, che all'attivazione cancella le cache
// dei deploy precedenti (file statici e icone vecchi, pagina /offline).

type BuildEnv = Record<string, string | undefined>;

/** Commit del deploy su Vercel, altrimenti l'id del deploy; fuori da Vercel "local". */
export function serviceWorkerVersion(env: BuildEnv): string {
  const source = env.VERCEL_GIT_COMMIT_SHA || env.VERCEL_DEPLOYMENT_ID || "local";
  return source.replace(/[^\w-]/g, "").slice(0, 40) || "local";
}

/** URL di registrazione del worker per una versione. */
export const serviceWorkerQuery = (version: string): string => `?v=${encodeURIComponent(version)}`;
