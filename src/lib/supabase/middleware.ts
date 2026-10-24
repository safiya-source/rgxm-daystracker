import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth", "/api/cron"];

/** Names (never values) of required settings that are missing or malformed. */
function configProblems(): string[] {
  const problems: string[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) problems.push("NEXT_PUBLIC_SUPABASE_URL is missing");
  else if (!/^https?:\/\/[^/\s]+\/?$/.test(url.trim())) problems.push("NEXT_PUBLIC_SUPABASE_URL should look like https://xxxx.supabase.co (nothing after .co)");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is missing");
  return problems;
}

function setupErrorPage(lines: string[]) {
  const items = lines.map((l) => `<li>${l.replace(/</g, "&lt;")}</li>`).join("");
  return new NextResponse(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>RGXM People: setup needed</title>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 20px;color:#1d1c1a">
<h1 style="font-size:22px">RGXM People can't start yet</h1><ul style="line-height:1.6">${items}</ul>
<p style="color:#77736b">In Vercel: Settings → Environment Variables, fix the above (NEXT_PUBLIC_… variables as <b>Config</b>), then Deployments → ⋯ → Redeploy.</p></body>`,
    { status: 500, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

export async function updateSession(request: NextRequest) {
  // Explain configuration mistakes instead of crashing with MIDDLEWARE_INVOCATION_FAILED.
  const problems = configProblems();
  if (problems.length) return setupErrorPage(problems);

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/$/, ""), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  let user = null;
  try {
    ({ data: { user } } = await supabase.auth.getUser());
  } catch {
    return setupErrorPage(["Couldn't reach Supabase. Check that NEXT_PUBLIC_SUPABASE_URL is your project's URL and the project isn't paused."]);
  }
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
