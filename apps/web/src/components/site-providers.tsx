import { MotionPolicy } from "@repo/ui/lib/motion-policy";

import { ThemeProvider } from "./theme-provider";

// the document's one theme provider: each writes .dark on <html>, so a page that mounted a
// second would fight this one for the class
export const SiteProviders = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <MotionPolicy>{children}</MotionPolicy>
  </ThemeProvider>
);
