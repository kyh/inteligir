import SupabaseProvider from "~/components/providers/supabase-provider";
import PHProvider from "~/components/providers/posthog-provider";
import "./globals.css";
import { Toaster } from "~/components/ui/toaster";

export const metadata = {
  title: "Suparepo",
  description: "A repo for Next.js (App Router) + Supabase",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className="dark dark:selection:bg-white dark:selection:text-black"
    >
      <head />
      <body className="dark:bg-brand-950">
        <PHProvider>
          <SupabaseProvider>{children}</SupabaseProvider>
        </PHProvider>
        <Toaster />
      </body>
    </html>
  );
}
