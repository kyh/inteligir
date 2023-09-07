import GeneralComponent from "~/app/(protected)/components/GeneralComponent";
import SettingsShell from "~/app/(protected)/components/SettingsShell";
import { Database } from "~/lib/types";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function GeneralPage({
  params,
}: {
  params: { slug: string };
}) {
  const { slug: teamIdString } = params;

  // convert teamId to number
  const teamId = parseInt(teamIdString, 10);

  // setup supabase
  const supabase = createServerComponentClient<Database>({ cookies });

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

  if (!profile) {
    redirect("/signin");
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

  const { data: userMembership, error: userMembershipError } = await supabase
    .from("members")
    .select("*")
    .eq("user_id", user.id)
    .eq("team_id", teamId)
    .single();

  if (userMembershipError) {
    console.error("Error fetching user membership:", userMembershipError);
    return;
  }

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
    redirect("/signin");
  }

  return (
    <SettingsShell
      profile={profile}
      allTeams={teamsData}
      team={team}
      title="General"
      description="Your team settings"
    >
      <GeneralComponent team={team} userMembership={userMembership} />
    </SettingsShell>
  );
}
