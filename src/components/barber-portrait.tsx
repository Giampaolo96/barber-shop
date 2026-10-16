import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { cn } from "@/lib/utils";

// Ritratto quadrato in scala di grigi (fetta 8b) o, senza foto, l'iniziale in un riquadro
// tratteggiato. Il server salva già WebP 512×512: niente ottimizzazione di Next (fetta 8d).
export function BarberPortrait({
  name,
  photoUrl,
  className,
  placeholderClassName,
}: {
  name: string;
  photoUrl: string | null;
  className?: string;
  placeholderClassName?: string;
}) {
  if (!photoUrl) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex aspect-square w-full items-center justify-center border border-dashed border-ink font-display text-6xl",
          placeholderClassName,
        )}
      >
        {name.charAt(0)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoUrl}
      alt={fillText(it.booking.barber.portraitAlt, { name })}
      width={512}
      height={512}
      loading="lazy"
      decoding="async"
      className={cn("aspect-square w-full border border-ink object-cover grayscale", className)}
    />
  );
}
