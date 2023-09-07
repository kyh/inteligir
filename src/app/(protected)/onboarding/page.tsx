import Onboarding from "../components/Onboarding";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
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

  // if user has onboarded, redirect to start

  if (profile?.hasOnboarded) {
    redirect(`/start`);
  }

  return (
    <div className="h-screen">
      <Onboarding user={profile} />
    </div>
  );
}
