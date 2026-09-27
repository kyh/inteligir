import { createFileRoute } from "@tanstack/react-router";

import { MarkdownPage } from "@/components/markdown-page";
import { markdownHandler, varyHeaders } from "@/lib/markdown-route";
import { siteConfig } from "@/lib/site-config";
import { aboutMarkdown } from "@/lib/site-content";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: `About · ${siteConfig.name}` }] }),
  headers: varyHeaders,
  component: () => <MarkdownPage markdown={aboutMarkdown} />,
  server: { handlers: { GET: markdownHandler(aboutMarkdown) } },
});
