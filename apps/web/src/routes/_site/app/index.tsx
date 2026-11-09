import { createFileRoute, redirect } from "@tanstack/react-router";

import { SIGNED_IN_HOME } from "#lib/next-path";

// bare /app is the layout with no child, an empty 200
export const Route = createFileRoute("/_site/app/")({
  beforeLoad: () => {
    redirect({ href: SIGNED_IN_HOME, reloadDocument: true, throw: true });
  },
});
