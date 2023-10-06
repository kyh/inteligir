import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type AuthLayoutProps = {
  children: React.ReactNode;
};

export default async function AuthLayout({ children }: AuthLayoutProps) {
  const supabase = getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) return redirect(`/start`);

  return <div className="h-screen">{children}</div>;
}
