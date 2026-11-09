import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/v1/blobs/$")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.doors.blobs(request),
    },
  },
});
