import Start from "../components/Start";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "~/lib/supabase";

export const revalidate = 0;

export const dynamic = "force-dynamic";

export default async function StartPage() {
  const supabase = getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // get user profile

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // if user has not onboarded, redirect to onboarding

  if (!profile.has_onboarded) {
    redirect(`/onboarding`);
  }

  const email = user.email;

  // get the teams the user is a member of

  // const { data: teams } = await supabase.from("teams").select("*");

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

  // Get invites for the user

  const { data: invitesData, error: invitesError } = await supabase
    .from("invites")
    .select("*")
    .eq("email", email);

  if (invitesError) {
    console.error("Error fetching user invites:", invitesError);
    return;
  }

  if (!invitesData) {
    redirect("/login");
  }

  // Extract the team IDs from the result

  const teamIdsFromInvites = invitesData.map((invite) => invite.team_id);

  // Fetch the teams using the team IDs

  const { data: teamsDataFromInvites, error: teamsErrorFromInvites } =
    await supabase.from("teams").select("*").in("id", teamIdsFromInvites);

  if (teamsErrorFromInvites) {
    console.error("Error fetching teams:", teamsErrorFromInvites);
    return;
  }

  if (!teamsDataFromInvites) {
    redirect("/login");
  }

  const filteredTeamsDataFromInvites = teamsDataFromInvites.filter(
    (teamFromInvite) => !teamIds.includes(teamFromInvite.id),
  );

  return (
    <div className="h-screen">
      <Start
        teams={teamsData}
        invites={invitesData}
        teamsFromInvites={filteredTeamsDataFromInvites}
      />
    </div>
  );
}
