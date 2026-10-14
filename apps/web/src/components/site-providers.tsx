import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { SizeProvider } from "@repo/ui/lib/size-context";

import { ThemeProvider } from "./theme-provider";

// the document's one theme provider: each writes .dark on <html>, so a page that mounted a
// second would fight this one for the class
export const SiteProviders = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <MotionPolicy>
      <SizeProvider size="compact">{children}</SizeProvider>
    </MotionPolicy>
  </ThemeProvider>
);
