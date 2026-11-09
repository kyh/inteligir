import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.doors.authorizationServerMetadata(request),
    },
  },
});
