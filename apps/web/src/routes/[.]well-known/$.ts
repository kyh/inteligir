import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/$")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.service(request),
    },
  },
});
