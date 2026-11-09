// Migliorie della review della fetta 8h: l'avviso "solo le ultime 200" vale per tutto l'elenco, non
// solo per le passate (con 200 future le passate sarebbero "nessuna" accanto all'avviso).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { it as text } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/booking/page-context", () => ({
  loadBookingPageContext: async () => ({ shop: { timezone: "Europe/Rome", phone: null, cancelLimitMin: 120 } }),
}));
vi.mock("@/lib/auth/current-user", () => ({ getVerifiedUserId: async () => "c8000000-0000-4000-8000-000000000001" }));
vi.mock("@/components/booking/cancel-booking-button", () => ({ CancelBookingButton: () => null }));
vi.mock("@/themes/active", () => ({ EmptyMark: () => null }));
vi.mock("@/lib/booking/queries", () => ({
  MY_BOOKINGS_LIMIT: 200,
  getMyBookings: async () => ({
    truncated: true,
    bookings: Array.from({ length: 200 }, (_, i) => ({
      id: `d8000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      startsAt: new Date(Date.UTC(2099, 0, 1) + i * 86_400_000).toISOString(),
      status: "confirmed",
      durationMin: 30,
      priceCents: 2000,
      notes: null,
      serviceName: "Taglio",
      barberName: "Mario",
    })),
  }),
}));

describe("/prenotazioni: avviso del limite", () => {
  test("fuori dalla sezione delle passate, come stato della pagina", async () => {
    const { default: Page } = await import("./page");
    const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    const warning = fillText(text.booking.list.myBookingsTruncated, { count: 200 });
    const at = markup.indexOf(warning);
    expect(at).toBeGreaterThan(markup.lastIndexOf("</section>"));
    expect(markup.slice(0, at)).toMatch(/<p role="status"[^>]*>$/);
  });
});
