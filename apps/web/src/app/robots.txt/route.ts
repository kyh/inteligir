import { siteConfig } from "#lib/site-config";

const body = [
  "User-agent: *",
  "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
  "Allow: /",
  "",
  `Sitemap: ${siteConfig.url}/sitemap.xml`,
  "",
].join("\n");

export const GET = () =>
  new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
