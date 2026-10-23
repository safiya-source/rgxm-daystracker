import { requireLeader } from "@/lib/auth";

export default async function LeadershipLayout({ children }: { children: React.ReactNode }) {
  await requireLeader();
  return children;
}
