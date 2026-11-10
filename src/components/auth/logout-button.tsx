import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { logout } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

/** Logout con un form (POST verso la server action), mai con un link; `quiet` ne ha solo l'aspetto. */
export function LogoutButton({
  quiet = false,
  className,
  buttonClassName,
}: {
  quiet?: boolean;
  /** Classi del form. */
  className?: string;
  /** Classi del pulsante (per allinearlo ai link vicini). */
  buttonClassName?: string;
}) {
  return (
    <form action={logout} className={className}>
      <Button
        type="submit"
        variant={quiet ? "link" : "outline"}
        className={cn("h-11 px-4", quiet && "border-0 px-3", buttonClassName)}
      >
        {it.auth.logout}
      </Button>
    </form>
  );
}
