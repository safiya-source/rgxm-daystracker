"use client";

import { useEffect } from "react";

/**
 * If a sign-in link lands on the wrong page (e.g. Supabase falls back to the
 * Site URL, or a link was created by an older version), forward its tokens to
 * /auth/confirm so the person still gets signed in instead of seeing "sign in".
 */
export function AuthLinkForwarder() {
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    if (pathname.startsWith("/auth/confirm")) return;
    const h = new URLSearchParams(hash.slice(1));
    const q = new URLSearchParams(search);
    const hasTokens = h.has("access_token") || h.has("error_description") || q.has("code") || q.has("token_hash");
    if (!hasTokens) return;
    if (!q.has("next")) q.set("next", "/auth/set-password");
    window.location.replace(`/auth/confirm?${q}${hash}`);
  }, []);
  return null;
}
