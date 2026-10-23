import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { setPassword } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Choose a password" };

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <AuthShell title="Choose a password" subtitle={`For ${user.email}. Use at least 10 characters.`}>
      <ActionForm action={setPassword} className="space-y-4">
        <Field label="New password">
          <Input name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus />
        </Field>
        <Field label="Confirm password">
          <Input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <SubmitButton className="w-full" size="lg">Save and continue</SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
