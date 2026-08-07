import { lazy, Suspense } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { currentSession } from "@/lib/session-guard";

// The workspace, behind a dynamic import — which is what keeps Plate and the
// ~30 packages under it out of the marketing route's bundle.
//
// The `import.meta.env.SSR` branch is not defensive: this route tree never
// server-renders, and the constant folds per build environment, so the SSR
// pass drops the `import()` as unreachable instead of pulling the whole
// workspace into the Worker's own bundle. Without it the deployed script grows
// by ~30 MB of code no request can ever reach.
const WorkspaceMount = lazy(async () => {
  if (import.meta.env.SSR) throw new Error("the workspace is client-only");
  return import("@/app/workspace-mount");
});

export const Route = createFileRoute("/app/")({
  // The gate is the router's, not the component's: a signed-out visitor should
  // never mount the workspace at all, and `beforeLoad` is the only place that
  // can decide before the chunk is even fetched.
  beforeLoad: async () => {
    const session = await currentSession();
    if (session === null) throw redirect({ to: "/app/sign-in" });
    return { session };
  },
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const { session } = Route.useRouteContext();
  return (
    <Suspense fallback={<Loading />}>
      <WorkspaceMount userId={session.userId} email={session.email} token={session.token} />
    </Suspense>
  );
}

function Loading() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </main>
  );
}
