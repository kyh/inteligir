import { Database } from "~/lib/types";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  // if user has not onboarded, redirect to onboarding
  if (!profile.has_onboarded) {
    redirect(`/onboarding`);
  }

  return <div>{children}</div>;
}
