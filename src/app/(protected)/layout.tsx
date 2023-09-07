import { Database } from "~/lib/types";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerComponentClient<Database>({
    cookies,
  });

  const session = await supabase.auth.getSession();

  if (!session?.data?.session) {
    return redirect("/signin");
  }

  const email = session.data.session.user?.email;

  if (!email) {
    return redirect("/signin");
  }

  return <div>{children}</div>;
}
