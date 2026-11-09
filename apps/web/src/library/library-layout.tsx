// CLAUDE.md § WINDOW-LEVEL HOSTS MOUNT AT THE ROOT ROUTE. Mounted above every route so Settings
// and back keeps one theme, one toaster, one confirm host, one notice of writes waiting for a
// connection and one of the Mac app's update; the QueryClient and the library are
// the router's own context, wrapped around every route (`router.tsx`).

import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { SizeProvider } from "@repo/ui/lib/size-context";
import { ThemeProvider } from "@repo/ui/lib/theme";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import { AppearanceProvider } from "./appearance";
import { PausedWrites } from "./cloud/needs-connection";
import { PREFS, usePref } from "./prefs";
import { UpdateNotice } from "./update-notice";
import type { PageContext } from "./test-support/library-router";

const RootLayout = () => {
  const [theme, chooseTheme] = usePref(PREFS.theme);
  return (
    <ThemeProvider theme={theme} setTheme={chooseTheme}>
      <SizeProvider size="compact">
        <AppearanceProvider>
          <MotionPolicy>
            <TooltipProvider>
              <Outlet />
              <ConfirmDialogHost />
              <Toaster position="bottom-right" />
              <PausedWrites />
              <UpdateNotice />
            </TooltipProvider>
          </MotionPolicy>
        </AppearanceProvider>
      </SizeProvider>
    </ThemeProvider>
  );
};

const NotFound = () => (
  <div className="flex min-h-dvh items-center justify-center">
    <p>This page isn’t part of your library.</p>
  </div>
);

export const Route = createRootRouteWithContext<PageContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});
