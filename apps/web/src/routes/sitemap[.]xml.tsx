import { createFileRoute } from "@tanstack/react-router";

import { statedDate } from "@/lib/page-meta";
import { SITEMAP_PATHS } from "@/lib/site-content";
import { buildSitemap } from "@/lib/sitemap";

import privacy from "../../../../docs/privacy.md?raw";
import terms from "../../../../docs/terms.md?raw";

// the legal docs state their own effective date; the other pages state none, so they carry no
// lastmod rather than a guessed one
const STATED: Partial<Record<(typeof SITEMAP_PATHS)[number], string | null>> = {
  "/privacy": statedDate(privacy),
  "/terms": statedDate(terms),
};

const body = buildSitemap(SITEMAP_PATHS.map((path) => ({ lastModified: STATED[path], path })));

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(body, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
