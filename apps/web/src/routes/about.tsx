import { createFileRoute } from "@tanstack/react-router";

import { MarkdownPage } from "@/components/markdown-page";
import { markdownHandler, varyHeaders } from "@/lib/markdown-route";
import { PAGES } from "@/lib/page-meta";
import { pageHead } from "@/lib/page-head";
import { aboutMarkdown } from "@/lib/site-content";

export const Route = createFileRoute("/about")({
  head: () => pageHead(PAGES.about),
  headers: varyHeaders,
  component: () => <MarkdownPage markdown={aboutMarkdown} />,
  server: { handlers: { GET: markdownHandler(aboutMarkdown) } },
});
