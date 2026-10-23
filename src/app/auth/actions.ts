"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/components/forms";
import { str } from "@/lib/actions";

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export async function signIn(_: ActionResult, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: str(form, "email"), password: String(form.get("password") ?? "") });
  if (error) return { error: "That email and password don't match. Try again or reset your password." };
  const next = str(form, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function requestPasswordReset(_: ActionResult, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(str(form, "email"), {
    redirectTo: `${await siteUrl()}/auth/confirm?next=/auth/set-password`,
  });
  // Same response whether or not the account exists.
  return { message: "If that email has an account, a reset link is on its way." };
}

export async function setPassword(_: ActionResult, form: FormData): Promise<ActionResult> {
  const password = String(form.get("password") ?? "");
  if (password.length < 10) return { error: "Use at least 10 characters." };
  if (password !== String(form.get("confirm") ?? "")) return { error: "Passwords don't match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/dashboard");
}
