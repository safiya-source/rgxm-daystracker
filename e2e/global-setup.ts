import { execSync } from "node:child_process";

export default function globalSetup() {
  if (process.env.E2E_SKIP_RESET) return;
  execSync("npx supabase db reset", { stdio: "inherit" });
  execSync("node --env-file=.env.local scripts/seed-demo.mjs", { stdio: "inherit" });
}
