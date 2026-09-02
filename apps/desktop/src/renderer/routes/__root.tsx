// Mounted above every route so /settings and back keeps the one QueryClient
// and socket, but not above RouterProvider: RenderCrash is the router's
// defaultErrorComponent, so a provider outside it throws with no boundary.
// The confirm and toast hosts live here because a host mounted by one route
// leaves every other route's confirm() pending forever.

import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { createRootRoute, Outlet } from "@tanstack/react-router";

import { WorkspaceProvider } from "../app/workspace-context";

export const Route = createRootRoute({
  notFoundComponent: NotFound,
  component: RootLayout,
});

function RootLayout() {
  return (
    <WorkspaceProvider>
      <TooltipProvider>
        <Outlet />
        <ConfirmDialogHost />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </WorkspaceProvider>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p>404: This page could not be found.</p>
    </div>
  );
}
