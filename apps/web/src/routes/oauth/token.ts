import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/oauth/token")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.doors.oauthToken(request),
    },
  },
});
