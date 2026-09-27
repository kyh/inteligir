import { createFileRoute } from "@tanstack/react-router";

import { MarkdownPage } from "@/components/markdown-page";
import { markdownHandler, varyHeaders } from "@/lib/markdown-route";
import { siteConfig } from "@/lib/site-config";

// the doc itself rather than a copy, so the page cannot say something docs/privacy.md does not
import privacy from "../../../../docs/privacy.md?raw";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: `Privacy · ${siteConfig.name}` }] }),
  headers: varyHeaders,
  component: () => <MarkdownPage markdown={privacy} />,
  server: { handlers: { GET: markdownHandler(privacy) } },
});
