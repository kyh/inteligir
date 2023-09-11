import BillingComponent from "~/app/(protected)/components/BillingComponent";
import SettingsShell from "~/app/(protected)/components/SettingsShell";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "~/lib/supabase";
import { stripe } from "~/lib/stripe";

export const dynamic = "force-dynamic";

export default async function BillingPage({
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

  const { data: products } = await stripe.products.list({
    active: true,
  });

  const { data: prices } = await stripe.prices.list({
    active: true,
  });

  return (
    <SettingsShell
      profile={profile}
      allTeams={teamsData}
      team={team}
      title="Billing"
      description="View and manage your plans and invoices"
    >
      <BillingComponent team={team} products={products} prices={prices} />
    </SettingsShell>
  );
}
