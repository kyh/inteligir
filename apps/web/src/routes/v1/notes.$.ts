import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/v1/notes/$")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.doors.note(request),
    },
  },
});
