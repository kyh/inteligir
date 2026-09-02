import { createFileRoute, redirect } from "@tanstack/react-router";

// bare /app is the layout with no child, an empty 200; old links still point here
export const Route = createFileRoute("/app/")({
  beforeLoad: () => {
    throw redirect({ to: "/app/sign-in" });
  },
});
