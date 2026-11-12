import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import Markdown from "react-markdown";
import type { ExtraProps } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { SiteHeader } from "#components/site-header";
import { siteConfig } from "#lib/site-config";

// a policy's table holds sentences, headers included, so it scrolls in a box of its own at a width
// its columns can wrap in: typeset's unwrapped headers would otherwise set the page's width, and its
// max-content scroll puts each sentence on one line
const WideTable = ({ node: _node, ...props }: ComponentProps<"table"> & ExtraProps) => (
  <div className="typeset-scroll">
    <table {...props} className="w-auto min-w-full [&_th]:min-w-36 [&_th]:whitespace-normal" />
  </div>
);

export const MarkdownPage = ({ markdown }: { markdown: string }) => (
  <>
    <SiteHeader />
    <main className="mx-auto w-full max-w-2xl px-6 pt-16 pb-24">
      <Link to="/" className="text-sm font-medium tracking-tight">
        {siteConfig.name}
      </Link>
      <article className="typeset">
        <Markdown
          components={{ table: WideTable }}
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSlug]}
        >
          {markdown}
        </Markdown>
      </article>
    </main>
  </>
);
