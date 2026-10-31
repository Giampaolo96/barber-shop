import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { logout } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

/** Logout con un form (POST verso la server action), mai con un link; `quiet` ne ha solo l'aspetto. */
export function LogoutButton({ quiet = false, className }: { quiet?: boolean; className?: string }) {
  return (
    <form action={logout} className={className}>
      <Button type="submit" variant={quiet ? "link" : "outline"} className={cn("h-11 px-4", quiet && "border-0 px-3")}>
        {it.auth.logout}
      </Button>
    </form>
  );
}
