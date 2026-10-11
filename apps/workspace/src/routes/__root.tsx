// Mounted above every route so /settings and back keeps the one QueryClient
// and socket, but not above RouterProvider: RenderCrash is the router's
// defaultErrorComponent, so a provider outside it throws with no boundary.
// The confirm and toast hosts live here because a host mounted by one route
// leaves every other route's confirm() pending forever.

import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { createRootRoute, Outlet } from "@tanstack/react-router";

import { SignedOutNotice } from "../app/signed-out-notice";
import { useSignedOut } from "../app/signed-out-state";
import { WorkspaceProvider } from "../app/workspace-context";

// signed out, every call is refused: the one notice stands in for the toast each would raise.
const RootLayout = () => {
  const signedOut = useSignedOut();
  return (
    <WorkspaceProvider>
      <MotionPolicy>
        <TooltipProvider>
          <Outlet />
          <ConfirmDialogHost />
          {signedOut ? <SignedOutNotice /> : <Toaster position="bottom-right" />}
        </TooltipProvider>
      </MotionPolicy>
    </WorkspaceProvider>
  );
};

const NotFound = () => (
  <div className="flex min-h-dvh items-center justify-center">
    <p>404: This page could not be found.</p>
  </div>
);

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});
