import MembersComponent from "~/app/(protected)/components/MembersComponent";
import SettingsShell from "~/app/(protected)/components/SettingsShell";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "~/lib/supabase";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  params,
}: {
  params: { slug: string };
}) {
  const { slug: teamIdString } = params;
  const teamId = parseInt(teamIdString, 10);

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

  if (!profile) {
    redirect("/login");
  }

  // get the team with the given ID
  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("*")
    .eq("id", teamId)
    .single();

  if (teamError) {
    console.error("Error fetching team:", teamError);
    return;
  }

  // get the user's membership for the team
  const { data: userMember, error: userMembershipError } = await supabase
    .from("members")
    .select("*")
    .eq("user_id", user.id)
    .eq("team_id", teamId)
    .single();

  if (userMembershipError) {
    console.error("Error fetching user membership:", userMembershipError);
    return;
  }

  // get all the members of the team
  const { data: membersData, error: membersError } = await supabase
    .from("members")
    .select("*")
    .eq("team_id", teamId);

  if (membersError) {
    console.error("Error fetching members:", membersError);
    return;
  }

  // Then, get the profile information for each user ID
  const memberIds = membersData.map((member) => member.user_id);

  const { data: profilesData, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .in("id", memberIds);

  if (profilesError) {
    console.error("Error fetching profiles:", profilesError);
    return;
  }

  // get all the invites of the team
  const { data: invitesData, error: invitesError } = await supabase
    .from("invites")
    .select("*")
    .eq("team_id", teamId);

  if (invitesError) {
    console.error("Error fetching invites:", invitesError);
    return;
  }

  const filteredInvites = invitesData.filter(
    (invite) => !profilesData.find((profile) => profile.email === invite.email),
  );

  // get the team IDs the user is a member of
  const { data: membershipsData, error: membershipsError } = await supabase
    .from("members")
    .select("team_id")
    .eq("user_id", user.id);

  if (membershipsError) {
    console.error("Error fetching user team memberships:", membershipsError);
    return;
  }

  // Extract the team IDs from the result
  const teamIds = membershipsData.map((membership) => membership.team_id);

  // Fetch the teams using the team IDs
  const { data: teamsData, error: teamsError } = await supabase
    .from("teams")
    .select("*")
    .in("id", teamIds);

  if (teamsError) {
    console.error("Error fetching teams:", teamsError);
    return;
  }

  if (!teamsData) {
    redirect("/login");
  }

  return (
    <SettingsShell
      profile={profile}
      allTeams={teamsData}
      team={team}
      title="Members"
      description={`Manage and invite team members`}
    >
      <MembersComponent
        team={team}
        user={profile}
        teamMembers={membersData}
        teamInvites={filteredInvites}
        userMember={userMember}
        teamMembersProfiles={profilesData}
      />
    </SettingsShell>
  );
}
