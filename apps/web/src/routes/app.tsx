import { createFileRoute, Outlet } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// `/app` — the product, and the one place on this site that never server-
// renders.
//
// `ssr: false` is declared HERE rather than per page because the router
// inherits it downward: a child route can never be more server-rendered than
// its parent, so the whole `/app` tree is client-only from one line. It has to
// be. Plate mutates its own editor nodes and the workspace reaches for
// `window` on the way up, and neither survives a render pass on workerd.
//
// The marketing route keeps its SSR. Nothing here is shared with it beyond the
// document shell in __root.tsx.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/app")({
  ssr: false,
  component: () => <Outlet />,
});
