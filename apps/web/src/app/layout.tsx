import { Toaster } from "@inteligir/ui";
import { ThemeProvider } from "@/lib/contexts/theme-provider";
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
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
};

export default RootLayout;
