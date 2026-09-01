// The workspace runtime is the WINDOW's, not a page's, so it is mounted here —
// above every route, so navigating to /settings and back keeps the one
// QueryClient and the one invalidation socket instead of disposing them and
// paying a cold vault walk and `git status` on the way back. Not above
// `RouterProvider`: RenderCrash is the router's `defaultErrorComponent`, so a
// provider outside it would throw with no boundary.
//
// The window-level HOSTS live here for the same reason. `confirm()` and
// `toast()` are called from any route — Settings' Unpair, Turn off voice and
// Remove connector all confirm-then-mutate — and a host mounted by one route
// leaves every other route's confirm pending forever and its refusal deferred
// until the user navigates back. One TooltipProvider, so adjacent tooltips
// share a skip delay app-wide instead of each re-waiting (tooltip.tsx).

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
