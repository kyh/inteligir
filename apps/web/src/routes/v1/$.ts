import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/v1/$")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.service(request),
    },
  },
});
