import { it } from "@/i18n/it";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-3xl font-semibold">{it.shop.name}</h1>
      <p className="text-base opacity-70">{it.home.comingSoon}</p>
    </main>
  );
}
