import Onboarding from "../components/Onboarding";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "~/lib/supabase";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signin");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profile?.hasOnboarded) {
    redirect(`/start`);
  }

  return (
    <div className="h-screen">
      <Onboarding user={profile} />
    </div>
  );
}
