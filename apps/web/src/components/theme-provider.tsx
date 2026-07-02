import { ThemeProvider as NextThemeProvider } from "next-themes";

// next-themes' ThemeProviderProps `extends React.PropsWithChildren`, but that
// clause drops `children` under TS6 + React 19 types — re-add it so the
// provider accepts children.
declare module "next-themes" {
  interface ThemeProviderProps {
    children?: React.ReactNode;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      {children}
    </NextThemeProvider>
  );
}
