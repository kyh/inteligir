import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sign-up")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.doors.signUp(request),
    },
  },
});
