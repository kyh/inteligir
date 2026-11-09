import { createFileRoute } from "@tanstack/react-router";

// a path under a door's prefix that no door answers is a plain 404, never the site's page
export const Route = createFileRoute("/v1/$")({
  server: {
    handlers: {
      ANY: () => new Response("not found", { status: 404 }),
    },
  },
});
