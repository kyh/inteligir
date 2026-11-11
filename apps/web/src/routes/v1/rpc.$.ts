import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/v1/rpc/$")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.doors.rpc(request),
    },
  },
});
