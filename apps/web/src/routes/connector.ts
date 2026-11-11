import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/connector")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.doors.connector(request),
    },
  },
});
