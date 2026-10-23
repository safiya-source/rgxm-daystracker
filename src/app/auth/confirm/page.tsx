"use client";

// Completes invite / password-reset links. Handles all three formats Supabase
// can produce: PKCE (?code=), token hash (?token_hash=&type=), and implicit
// (#access_token=…, used by admin invites).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth-shell";
import { Alert, LinkButton } from "@/components/ui";
import type { EmailOtpType } from "@supabase/supabase-js";

export default function ConfirmPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const next = url.searchParams.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/auth/set-password";

    (async () => {
      let res: { error: { message: string } | null };
      if (hash.get("error_description")) {
        res = { error: { message: hash.get("error_description")! } };
      } else if (url.searchParams.get("code")) {
        res = await supabase.auth.exchangeCodeForSession(url.searchParams.get("code")!);
      } else if (url.searchParams.get("token_hash")) {
        res = await supabase.auth.verifyOtp({
          token_hash: url.searchParams.get("token_hash")!,
          type: (url.searchParams.get("type") ?? "invite") as EmailOtpType,
        });
      } else if (hash.get("access_token") && hash.get("refresh_token")) {
        res = await supabase.auth.setSession({ access_token: hash.get("access_token")!, refresh_token: hash.get("refresh_token")! });
      } else {
        res = { error: { message: "This link is missing its security token." } };
      }
      if (res.error) setError(res.error.message);
      else router.replace(safeNext);
    })();
  }, [router]);

  return (
    <AuthShell title={error ? "That link didn't work" : "Signing you in…"}>
      {error ? (
        <div className="space-y-4">
          <Alert tone="danger">{error}. Links expire after a while and can only be used once.</Alert>
          <LinkButton href="/forgot-password" variant="secondary" className="w-full">Request a new link</LinkButton>
        </div>
      ) : (
        <p className="text-muted">Just a moment.</p>
      )}
    </AuthShell>
  );
}
