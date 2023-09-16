import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = getSupabaseServerClient();

  const session = await supabase.auth.getSession();

  if (!session?.data?.session) {
    return redirect("/login");
  }

  const email = session.data.session.user?.email;

  if (!email) {
    return redirect("/login");
  }

  return <>{children}</>;
}
