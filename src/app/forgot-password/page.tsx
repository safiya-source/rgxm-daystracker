import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { requestPasswordReset } from "@/app/auth/actions";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a secure link to choose a new one.">
      <ActionForm action={requestPasswordReset} className="space-y-4">
        <Field label="Work email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <SubmitButton className="w-full" size="lg" pendingText="Sending…">Send reset link</SubmitButton>
        <p className="text-center text-sm text-muted">
          <Link href="/login" className="underline-offset-4 hover:underline">Back to sign in</Link>
        </p>
      </ActionForm>
    </AuthShell>
  );
}
