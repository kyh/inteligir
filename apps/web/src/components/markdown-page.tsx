import Link from "next/link";
import type { ComponentProps } from "react";
import Markdown from "react-markdown";
import type { ExtraProps } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { siteConfig } from "#lib/site-config";

const WideTable = ({ node: _node, ...props }: ComponentProps<"table"> & ExtraProps) => (
  <div className="typeset-scroll">
    <table {...props} className="w-auto min-w-full [&_th]:min-w-36 [&_th]:whitespace-normal" />
  </div>
);

export const MarkdownPage = ({ markdown }: { markdown: string }) => (
  <main className="mx-auto w-full max-w-2xl px-6 pt-16 pb-24">
    <Link href="/" className="text-sm font-medium tracking-tight">
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
);
