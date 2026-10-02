import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { logout } from "@/lib/auth/actions";

/** Logout con un form (POST verso la server action), mai con un link. */
export function LogoutButton() {
  return (
    <form action={logout}>
      <Button type="submit" variant="outline" className="h-11 px-4">
        {it.auth.logout}
      </Button>
    </form>
  );
}
