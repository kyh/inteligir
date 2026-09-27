import { createFileRoute } from "@tanstack/react-router";

import { MarkdownPage } from "@/components/markdown-page";
import { markdownHandler, varyHeaders } from "@/lib/markdown-route";
import { siteConfig } from "@/lib/site-config";
import { contactMarkdown } from "@/lib/site-content";

export const Route = createFileRoute("/contact")({
  head: () => ({ meta: [{ title: `Contact · ${siteConfig.name}` }] }),
  headers: varyHeaders,
  component: () => <MarkdownPage markdown={contactMarkdown} />,
  server: { handlers: { GET: markdownHandler(contactMarkdown) } },
});
