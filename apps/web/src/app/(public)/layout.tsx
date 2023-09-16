import { getSupabaseServerClient } from "@/lib/supabase";
import { Footer } from "./components/footer";
import { Header } from "./components/header";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = getSupabaseServerClient();
  const session = await supabase.auth.getSession();

  return (
    <>
      <Header session={session.data.session} />
      {children}
      <Footer />
    </>
  );
}
