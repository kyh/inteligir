import { InviteComponent } from "./components/InviteComponent";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";

export const revalidate = 0;

export const dynamic = "force-dynamic";

export default async function InvitationPage({
  params,
}: {
  params: { slug: string };
}) {
  const { slug: inviteIdString } = params;
  const inviteId = parseInt(inviteIdString, 10);

  const supabase = getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: inviteData, error: inviteError } = await supabase
    .from("invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (!inviteData) {
    redirect("/login");
  }

  const teamId = inviteData.team_id;

  // Fetch the teams using the team IDs
  const { data: teamData, error: teamError } = await supabase
    .from("teams")
    .select("*")
    .eq("id", teamId)
    .single();

  if (!teamData) {
    redirect("/login");
  }

  // Invitation email check
  const email = inviteData.email;

  if (email !== user.email) {
    redirect("/login");
  }

  return (
    <div className="h-screen">
      <InviteComponent team={teamData} user={profile} invite={inviteData} />
    </div>
  );
}
