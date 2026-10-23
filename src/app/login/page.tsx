import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { signIn } from "@/app/auth/actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to see your time off, lieu and team calendar.">
      <ActionForm action={signIn} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Work email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" size="lg" pendingText="Signing in…">Sign in</SubmitButton>
        <p className="text-center text-sm text-muted">
          <Link href="/forgot-password" className="underline-offset-4 hover:underline">Forgot your password?</Link>
        </p>
      </ActionForm>
    </AuthShell>
  );
}
