import { createFileRoute, Outlet } from "@tanstack/react-router";

// no `ssr` option here: the router inherits the flag downward, so `ssr: false` on this
// layout would make every auth form client-only

export const Route = createFileRoute("/app")({
  component: () => <Outlet />,
});
