import { createFileRoute, Link } from "@tanstack/react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { SiteHeader } from "@/components/site-header";
import { siteConfig } from "@/lib/site-config";

// the doc itself rather than a copy, so the page cannot say something docs/privacy.md does not
import privacy from "../../../../docs/privacy.md?raw";

const PrivacyPage = () => (
  <>
    <SiteHeader />
    <main className="mx-auto w-full max-w-2xl px-6 pt-16 pb-24">
      <Link to="/" className="text-sm font-medium tracking-tight">
        {siteConfig.name}
      </Link>
      <article className="typeset">
        <Markdown remarkPlugins={[remarkGfm]}>{privacy}</Markdown>
      </article>
    </main>
  </>
);

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: `Privacy · ${siteConfig.name}` }] }),
  component: PrivacyPage,
});
