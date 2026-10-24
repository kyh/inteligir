import { createFileRoute } from "@tanstack/react-router";

import { MarkdownPage } from "@/components/markdown-page";
import { markdownHandler, varyHeaders } from "@/lib/markdown-route";
import { PAGES } from "@/lib/page-meta";
import { pageHead } from "@/lib/page-head";
import { contactMarkdown } from "@/lib/site-content";

export const Route = createFileRoute("/contact")({
  head: () => pageHead(PAGES.contact),
  headers: varyHeaders,
  component: () => <MarkdownPage markdown={contactMarkdown} />,
  server: { handlers: { GET: markdownHandler(contactMarkdown) } },
});
