import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/oauth-protected-resource/connector")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.doors.connectorMetadata(request),
    },
  },
});
