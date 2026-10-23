import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ProfileView } from "@/components/profile-view";

export const metadata = { title: "My Profile" };

export default async function MyProfilePage() {
  const me = await requireProfile();
  const supabase = await createClient();
  await supabase.rpc("sync_my_vacation");
  const { data: approvers } = await supabase.rpc("my_approvers");
  return (
    <>
      <PageHeader title="My profile" subtitle="Your details are managed by People Admins. Something wrong? Let them know." />
      <ProfileView p={me} approvers={(approvers ?? []).map((a) => a.full_name)} />
    </>
  );
}
