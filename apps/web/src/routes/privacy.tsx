import { createFileRoute } from "@tanstack/react-router";

import { MarkdownPage } from "@/components/markdown-page";
import { markdownHandler, varyHeaders } from "@/lib/markdown-route";
import { legalHead } from "@/lib/page-head";
import { PAGES } from "@/lib/page-meta";

// the doc itself rather than a copy, so the page cannot say something docs/privacy.md does not
import privacy from "../../../../docs/privacy.md?raw";

export const Route = createFileRoute("/privacy")({
  head: () => legalHead(PAGES.privacy, privacy),
  headers: varyHeaders,
  component: () => <MarkdownPage markdown={privacy} />,
  server: { handlers: { GET: markdownHandler(privacy) } },
});
