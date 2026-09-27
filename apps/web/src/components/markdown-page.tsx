import { Link } from "@tanstack/react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { SiteHeader } from "@/components/site-header";
import { siteConfig } from "@/lib/site-config";

export const MarkdownPage = ({ markdown }: { markdown: string }) => (
  <>
    <SiteHeader />
    <main className="mx-auto w-full max-w-2xl px-6 pt-16 pb-24">
      <Link to="/" className="text-sm font-medium tracking-tight">
        {siteConfig.name}
      </Link>
      <article className="typeset">
        <Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>
      </article>
    </main>
  </>
);
