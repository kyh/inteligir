import { createFileRoute } from "@tanstack/react-router";

import { MarkdownPage } from "@/components/markdown-page";
import { markdownHandler, varyHeaders } from "@/lib/markdown-route";
import { legalHead } from "@/lib/page-head";
import { PAGES } from "@/lib/page-meta";

// the doc itself rather than a copy, so the page cannot say something docs/terms.md does not
import terms from "../../../../docs/terms.md?raw";

export const Route = createFileRoute("/terms")({
  head: () => legalHead(PAGES.terms, terms),
  headers: varyHeaders,
  component: () => <MarkdownPage markdown={terms} />,
  server: { handlers: { GET: markdownHandler(terms) } },
});
