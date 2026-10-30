import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui";

export const metadata = { title: "Account not active" };

export default function InactivePage() {
  return (
    <AuthShell title="Your account isn't active" subtitle="You're signed in, but there's no active RGXM Daystracker profile for this email. Ask a People Admin to check your account.">
      <form action="/auth/signout" method="post">
        <Button variant="secondary" className="w-full">Sign out</Button>
      </form>
    </AuthShell>
  );
}
