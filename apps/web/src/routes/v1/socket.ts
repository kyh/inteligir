import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/v1/socket")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.doors.socket(request),
    },
  },
});
