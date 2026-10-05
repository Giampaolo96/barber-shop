// Nome del negozio per la testata: la prima parola in evidenza, il resto sotto (fetta 8a).
// Il nome viene sempre da shop_settings, mai scritto nel codice.

export function splitShopName(name: string): { lead: string; rest: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return { lead: words[0] ?? "", rest: words.slice(1).join(" ") };
}
