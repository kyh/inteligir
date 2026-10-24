import { createFileRoute, Outlet } from "@tanstack/react-router";

// no `ssr` option here: the router inherits the flag downward, so `ssr: false` on this
// layout would make every auth form client-only

export const Route = createFileRoute("/app")({
  // the account pages are forms for people already invited, never a search result
  head: () => ({ meta: [{ content: "noindex, nofollow", name: "robots" }] }),
  component: () => <Outlet />,
});
