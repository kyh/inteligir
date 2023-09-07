import { InviteComponent } from "./components/InviteComponent";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const revalidate = 0;

export const dynamic = "force-dynamic";

export default async function InvitationPage({
  params,
}: {
  params: { slug: string };
}) {
  const { slug: inviteIdString } = params;

  // convert teamId to number
  const inviteId = parseInt(inviteIdString, 10);

  // setup supabase
  const supabase = createServerComponentClient({ cookies });

  // get user

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signin");
  }

  // get user profile

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // get the invite data

  const { data: inviteData, error: inviteError } = await supabase
    .from("invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (!inviteData) {
    redirect("/signin");
  }

  const teamId = inviteData.team_id;

  // Fetch the teams using the team IDs
  const { data: teamData, error: teamError } = await supabase
    .from("teams")
    .select("*")
    .eq("id", teamId)
    .single();

  if (!teamData) {
    redirect("/signin");
  }

  // Invitation email check

  const email = inviteData.email;

  if (email !== user.email) {
    redirect("/signin");
  }

  return (
    <div className="h-screen">
      <InviteComponent team={teamData} user={profile} invite={inviteData} />
    </div>
  );
}
