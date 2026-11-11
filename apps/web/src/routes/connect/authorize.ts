import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/connect/authorize")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.doors.consent(request),
    },
  },
});
