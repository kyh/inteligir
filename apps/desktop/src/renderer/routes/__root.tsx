// The workspace runtime is the WINDOW's, not a page's, so it is mounted here —
// above every route, so navigating to /settings and back keeps the one
// QueryClient and the one invalidation socket instead of disposing them and
// paying a cold vault walk and `git status` on the way back. Not above
// `RouterProvider`: RenderCrash is the router's `defaultErrorComponent`, so a
// provider outside it would throw with no boundary.

import { createRootRoute, Outlet } from "@tanstack/react-router";

import { WorkspaceProvider } from "../app/workspace-context";

export const Route = createRootRoute({
  notFoundComponent: NotFound,
  component: RootLayout,
});

function RootLayout() {
  return (
    <WorkspaceProvider>
      <Outlet />
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
