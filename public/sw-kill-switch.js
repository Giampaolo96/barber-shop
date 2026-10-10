// Interruttore d'emergenza (ADR 009): se il service worker in produzione serve file sbagliati,
// si copia questo file su public/sw.js e si pubblica. Al prossimo controllo il browser lo installa:
// svuota tutte le cache, si deregistra e ricarica le pagine aperte, che tornano a usare solo la rete.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map((client) => (client.navigate ? client.navigate(client.url) : undefined)));
    })(),
  );
});
