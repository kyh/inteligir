import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { RadiusProvider } from "@repo/ui/lib/radius-context";
import { SizeProvider } from "@repo/ui/lib/size-context";

import { ThemeProvider } from "./theme-provider";

// the document's one theme provider: each writes .dark on <html>, so a page that mounted a
// second would fight this one for the class
export const SiteProviders = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <MotionPolicy>
      <RadiusProvider radius="rounded">
        <SizeProvider size="compact">{children}</SizeProvider>
      </RadiusProvider>
    </MotionPolicy>
  </ThemeProvider>
);
