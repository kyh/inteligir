import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "~/lib/supabase";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  if (!profile) {
    redirect("/signin");
  }

  if (!profile.has_onboarded) {
    redirect(`/onboarding`);
  }

  return <div>{children}</div>;
}
