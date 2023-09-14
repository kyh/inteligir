import { SupabaseProvider } from "~/components/providers/supabase-provider";
import { PHProvider } from "~/components/providers/posthog-provider";
import { ThemeProvider } from "~/components/providers/theme-provider";
import { Toaster } from "~/components/ui/toaster";
import "./globals.css";

export const metadata = {
  title: "Inteligir",
  description: "Build a data-informed team",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className="dark:bg-brand-950">
        <ThemeProvider>
          <PHProvider>
            <SupabaseProvider>{children}</SupabaseProvider>
          </PHProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
