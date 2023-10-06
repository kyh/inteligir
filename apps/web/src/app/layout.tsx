import { Toaster } from "ui/components/toaster";
import { SupabaseProvider } from "@/components/supabase-provider";
import { PHProvider } from "@/components/posthog-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata = {
  title: "Inteligir",
  description: "Build a data-informed team",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className="bg-ui-bg-base">
        <ThemeProvider>
          <PHProvider>
            <SupabaseProvider>{children}</SupabaseProvider>
          </PHProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
};

export default RootLayout;
