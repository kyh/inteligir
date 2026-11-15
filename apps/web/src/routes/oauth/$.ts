import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/oauth/$")({
  server: {
    handlers: {
      ANY: async ({ request, context }) => await context.service(request),
    },
  },
});
