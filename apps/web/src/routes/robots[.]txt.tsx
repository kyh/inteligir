import { createFileRoute } from "@tanstack/react-router";

import { siteConfig } from "@/lib/site-config";

const body = ["User-Agent: *", "Allow: /", "", `Sitemap: ${siteConfig.url}/sitemap.xml`, ""].join(
  "\n",
);

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
