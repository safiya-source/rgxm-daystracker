"use client";

// Completes invite / password-reset links. Handles all three formats Supabase
// can produce: PKCE (?code=), token hash (?token_hash=&type=), and implicit
// (#access_token=…, used by admin invites).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Button } from "@/components/ui";
import type { EmailOtpType } from "@supabase/supabase-js";

export default function ConfirmPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needsClick, setNeedsClick] = useState(false);
  const [busy, setBusy] = useState(false);

  const params = () => {
    const url = new URL(window.location.href);
    const next = url.searchParams.get("next");
    return {
      url,
      hash: new URLSearchParams(url.hash.slice(1)),
      safeNext: next && next.startsWith("/") && !next.startsWith("//") ? next : "/auth/set-password",
    };
  };

  // Shared invite / reset links (token_hash) wait for a click, so link previews
  // in Slack, WhatsApp or email scanners can't use up the single-use link.
  const verifyTokenHash = async () => {
    const { url, safeNext } = params();
    setBusy(true);
    const res = await createClient().auth.verifyOtp({
      token_hash: url.searchParams.get("token_hash")!,
      type: (url.searchParams.get("type") ?? "invite") as EmailOtpType,
    });
    if (res.error) { setError(res.error.message); setBusy(false); }
    else router.replace(safeNext);
  };

  useEffect(() => {
    const supabase = createClient();
    const { url, hash, safeNext } = params();
    if (url.searchParams.get("token_hash")) { setNeedsClick(true); return; }

    (async () => {
      let res: { error: { message: string } | null };
      if (hash.get("error_description")) {
        res = { error: { message: hash.get("error_description")! } };
      } else if (url.searchParams.get("code")) {
        res = await supabase.auth.exchangeCodeForSession(url.searchParams.get("code")!);
      } else if (hash.get("access_token") && hash.get("refresh_token")) {
        res = await supabase.auth.setSession({ access_token: hash.get("access_token")!, refresh_token: hash.get("refresh_token")! });
      } else {
        res = { error: { message: "This link is missing its security token." } };
      }
      if (res.error) setError(res.error.message);
      else router.replace(safeNext);
    })();
  }, [router]);

  if (error) {
    return (
      <AuthShell title="That link didn't work">
        <Alert tone="danger">{error}. Links can only be used once and expire after about an hour. Ask a People Admin for a new link.</Alert>
      </AuthShell>
    );
  }
  if (needsClick) {
    return (
      <AuthShell title="Welcome to RGXM People" subtitle="Next you'll choose a password for your account.">
        <Button size="lg" className="w-full" onClick={verifyTokenHash} disabled={busy}>{busy ? "One moment…" : "Continue"}</Button>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Signing you in…">
      <p className="text-muted">Just a moment.</p>
    </AuthShell>
  );
}
