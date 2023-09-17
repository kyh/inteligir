import { SupabaseProvider } from "@/components/supabase-provider";
import { PHProvider } from "@/components/posthog-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "ui/components/toaster";
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
