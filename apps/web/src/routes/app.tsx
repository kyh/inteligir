import { createFileRoute, Outlet } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// `/app` — the product.
//
// This layout carries NO `ssr` option, and that placement is the point: the
// router inherits the flag downward, so a child can never be more
// server-rendered than its parent. Declaring `ssr: false` here would make the
// auth pages — a form and two `useState`s — client-only by inheritance, and
// their whole first paint would wait on the JavaScript bundle.
//
// The two routes that genuinely cannot server-render say so themselves:
// `./app/index.tsx` (Plate mutates its own editor nodes) and `./app/link.tsx`
// (it reads `window.location` on the way up).
//
// The marketing route keeps its SSR. Nothing here is shared with it beyond the
// document shell in __root.tsx.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/app")({
  component: () => <Outlet />,
});
