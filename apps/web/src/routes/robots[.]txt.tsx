import { createFileRoute } from "@tanstack/react-router";

const body = ["User-Agent: *", "Allow: /", ""].join("\n");

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
