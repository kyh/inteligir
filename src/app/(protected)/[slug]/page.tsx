import HomeCard from "../components/HomeCard";
import Shell from "../components/Shell";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "~/lib/supabase";

export const dynamic = "force-dynamic";

export default async function TeamPage({
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

  const email = profile.email;

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

  const team = teamsData.find((team) => team.id === teamId);

  // Check invites
  const { data: invitesData, error: invitesError } = await supabase
    .from("invites")
    .select("*")
    .eq("email", email)
    .eq("team_id", teamId);

  if (invitesError) {
    console.error("Error fetching invites:", invitesError);
    return;
  }

  if (!invitesData) {
    redirect("/login");
  }
  if (team) {
    return (
      <Shell
        profile={profile}
        team={team}
        allTeams={teamsData}
        pageName="Home"
        subtitle="Your page for critical information and summaries"
      >
        <HomeCard />
      </Shell>
    );
  }

  if (invitesData.length > 0) {
    redirect(`/invitation/${invitesData[0].id}`);
  }

  redirect("/start");
}
