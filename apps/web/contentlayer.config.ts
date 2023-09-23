import {
  defineComputedFields,
  defineDocumentType,
  makeSource,
} from "contentlayer/source-files";
import type * as unified from "unified";
import { toMarkdown } from "mdast-util-to-markdown";
import { mdxToMarkdown } from "mdast-util-mdx";
import { bundleMDX } from "mdx-bundler";
import remarkGfm from "remark-gfm";
import type { DocumentGen } from "contentlayer/core";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";

// /** @type {import('contentlayer/source-files').ComputedFields} */
const computedSlugFields = defineComputedFields<
  "Page" | "Doc" | "Guide" | "Integration"
>({
  slug: {
    type: "string",
    resolve: (doc) => {
      const parts = doc._raw.flattenedPath.split("/");
      return parts[parts.length - 1];
    },
  },
  slugAsParams: {
    type: "string",
    resolve: (doc) => doc._raw.flattenedPath.split("/").slice(1).join("/"),
  },
});

export const Integration = defineDocumentType(() => ({
  name: "Integration",
  contentType: "mdx",
  filePathPattern: `integrations/*.mdx`,
  fields: {
    title: { type: "string", required: true },
    brief: { type: "string", required: true },
    heroImage: { type: "string", required: true },
    createdAt: { type: "date", required: true },
  },
  computedFields: {
    ...computedSlugFields,
  },
}));

export const Legal = defineDocumentType(() => ({
  name: "Legal",
  contentType: "mdx",
  filePathPattern: `legal/*.mdx`,
  fields: {
    title: { type: "string", required: true },
    createdAt: { type: "date", required: true },
    updatedAt: { type: "date", required: false },
  },
  computedFields: {
    ...computedSlugFields,
  },
}));

export const Template = defineDocumentType(() => ({
  name: "Template",
  contentType: "mdx",
  filePathPattern: `templates/*.mdx`,
  fields: {
    title: { type: "string", required: true },
    brief: { type: "string", required: true },
    heroImage: { type: "string", required: true },
    createdAt: { type: "date", required: true },
  },
  computedFields: {
    ...computedSlugFields,
  },
}));

const extractOrderFromWord = (
  word: string,
): { name: string; order: number } => {
  const re = /^((\d+)-)?(.*)$/;
  const [, , orderStr, name] = word.match(re) ?? [];
  const order = orderStr ? parseInt(orderStr) : 0;

  return { order, name: name ?? "" };
};

export const computeUrlFromFilePath = (doc: DocumentGen): string => {
  return doc._raw.flattenedPath
    .replace(/pages\/?/, "")
    .split("/")
    .map(extractOrderFromWord)
    .map((x) => x.name)
    .join("/");
};

export type DocHeading = { level: 1 | 2 | 3; title: string };

export const Documentation = defineDocumentType(() => ({
  name: "Documentation",
  filePathPattern: `docs/**/*.mdx`,
  contentType: "mdx",
  fields: {
    title: {
      type: "string",
      description: "The title of the page",
      required: true,
    },
    label: {
      type: "string",
    },
    excerpt: {
      type: "string",
      required: true,
    },
  },
  computedFields: {
    url_path: {
      type: "string",
      description:
        'The URL path of this page relative to site root. For example, the site root page would be "/", and doc page would be "docs/getting-started/"',
      resolve: computeUrlFromFilePath,
    },
    pathSegments: {
      type: "json",
      resolve: (doc) =>
        doc._raw.flattenedPath
          .split("/")
          .slice(1)
          .map((dirName) => extractOrderFromWord(dirName)),
    },
    headings: {
      type: "json",
      resolve: async (doc) => {
        const headings: DocHeading[] = [];

        await bundleMDX({
          source: doc.body.raw,
          mdxOptions: (opts) => {
            opts.remarkPlugins = [
              ...((opts.remarkPlugins ?? []) as any),
              tocPlugin(headings),
            ];

            return opts;
          },
        });

        return [{ level: 1, title: doc.title }, ...headings];
      },
    },
  },
  extensions: {},
}));

const tocPlugin =
  (headings: DocHeading[]): unified.Plugin =>
  () => {
    return (node: any) => {
      for (const element of node.children.filter(
        (child: any) => child.type === "heading",
      )) {
        const title = toMarkdown(
          { type: "paragraph", children: element.children },
          { extensions: [mdxToMarkdown()] },
        )
          .trim()
          .replace(/<.*$/g, "")
          .replace(/\\/g, "")
          .trim();

        headings.push({
          level: element.depth,
          title,
        });
      }
    };
  };

export default makeSource({
  contentDirPath: "content",
  documentTypes: [Template, Integration, Legal],
  mdx: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      rehypeSlug,
      [rehypePrettyCode as any, { theme: "github-dark", keepBackground: true }],
      [
        rehypeAutolinkHeadings,
        {
          properties: {
            className: ["subheading-anchor"],
            ariaLabel: "Link to section",
          },
        },
      ],
    ],
  },
});
