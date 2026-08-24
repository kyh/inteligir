import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  notFoundComponent: NotFound,
  component: Outlet,
});

function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p>404: This page could not be found.</p>
    </div>
  );
}
