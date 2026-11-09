import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/oauth/register")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.doors.oauthRegister(request),
    },
  },
});
