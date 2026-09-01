import { signOut } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

// The session indicator + logout control (PHASE A instructions §8). A
// plain Server Action form — no client-side JavaScript is required for
// logout to work, and it degrades correctly with JS disabled.
export function UserMenu({ email }: { email: string | null }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-600" aria-label="Signed in as">
        {email ?? "Signed in"}
      </span>
      <form action={signOut}>
        <Button type="submit" variant="secondary" size="sm">
          Log out
        </Button>
      </form>
    </div>
  );
}
