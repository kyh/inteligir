import { createFileRoute, redirect } from "@tanstack/react-router";

import { SIGNED_IN_HOME } from "@/lib/next-path";

// bare /app is the layout with no child, an empty 200; old links still point here
export const Route = createFileRoute("/app/")({
  beforeLoad: () => {
    redirect({ to: SIGNED_IN_HOME, throw: true });
  },
});
