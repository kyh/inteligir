import { createFileRoute, Outlet } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// `/app` — the account surface: sign-in, sign-up, forgot-password.
//
// This layout carries NO `ssr` option, and that placement is the point: the
// router inherits the flag downward, so a child can never be more
// server-rendered than its parent. Declaring `ssr: false` here would make the
// auth pages — a form and two `useState`s — client-only by inheritance, and
// their whole first paint would wait on the JavaScript bundle.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/app")({
  component: () => <Outlet />,
});
