// contentlayer.config.ts
import {
  defineComputedFields,
  defineDocumentType,
  makeSource
} from "contentlayer/source-files";
import { toMarkdown } from "mdast-util-to-markdown";
import { mdxToMarkdown } from "mdast-util-mdx";
import { bundleMDX } from "mdx-bundler";
import remarkGfm from "remark-gfm";
import * as fs from "node:fs/promises";
import path from "node:path";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
var computedSlugFields = defineComputedFields({
  slug: {
    type: "string",
    resolve: (doc) => {
      const parts = doc._raw.flattenedPath.split("/");
      return parts[parts.length - 1];
    }
  },
  slugAsParams: {
    type: "string",
    resolve: (doc) => doc._raw.flattenedPath.split("/").slice(1).join("/")
  }
});
var CodePage = defineDocumentType(() => ({
  name: "CodePage",
  contentType: "mdx",
  filePathPattern: `code-pages/*.mdx`,
  fields: {
    fileName: { type: "string", required: true }
  }
}));
var Log = defineDocumentType(() => ({
  name: "Log",
  contentType: "mdx",
  filePathPattern: `changelog/*.mdx`,
  fields: {
    title: { type: "string", required: true },
    author: { type: "string", required: true },
    heroImage: { type: "string", required: true },
    createdAt: { type: "date", required: true },
    updatedAt: { type: "date", required: false }
  },
  computedFields: {
    ...computedSlugFields
  }
}));
var Post = defineDocumentType(() => ({
  name: "Post",
  contentType: "mdx",
  filePathPattern: `blog/*.mdx`,
  fields: {
    title: { type: "string", required: true },
    author: { type: "string", required: true },
    brief: { type: "string", required: true },
    heroImage: { type: "string", required: true },
    readTimeInMinutes: { type: "number", required: true },
    createdAt: { type: "date", required: true },
    updatedAt: { type: "date", required: false }
  },
  computedFields: {
    ...computedSlugFields
  }
}));
var Author = defineDocumentType(() => ({
  name: "Author",
  contentType: "mdx",
  filePathPattern: `authors/*.mdx`,
  fields: {
    name: { type: "string", required: true },
    image: { type: "string", required: true }
  },
  computedFields: {
    ...computedSlugFields
  }
}));
var extractOrderFromWord = (word) => {
  const re = /^((\d+)-)?(.*)$/;
  const [, , orderStr, name] = word.match(re) ?? [];
  const order = orderStr ? parseInt(orderStr) : 0;
  return { order, name: name ?? "" };
};
var computeUrlFromFilePath = (doc) => {
  return doc._raw.flattenedPath.replace(/pages\/?/, "").split("/").map(extractOrderFromWord).map((x) => x.name).join("/");
};
var getLastEditedDate = (contentDirPath) => async (doc) => {
  const stats = await fs.stat(
    path.join(contentDirPath, doc._raw.sourceFilePath)
  );
  return stats.mtime;
};
var Doc = defineDocumentType(() => ({
  name: "Doc",
  filePathPattern: `docs/**/*.mdx`,
  contentType: "mdx",
  fields: {
    title: {
      type: "string",
      description: "The title of the page",
      required: true
    },
    label: {
      type: "string"
    },
    excerpt: {
      type: "string",
      required: true
    }
  },
  computedFields: {
    url_path: {
      type: "string",
      description: 'The URL path of this page relative to site root. For example, the site root page would be "/", and doc page would be "docs/getting-started/"',
      resolve: computeUrlFromFilePath
    },
    pathSegments: {
      type: "json",
      resolve: (doc) => doc._raw.flattenedPath.split("/").slice(1).map((dirName) => {
        return extractOrderFromWord(dirName);
      })
    },
    headings: {
      type: "json",
      resolve: async (doc) => {
        const headings = [];
        await bundleMDX({
          source: doc.body.raw,
          mdxOptions: (opts) => {
            opts.remarkPlugins = [
              ...opts.remarkPlugins ?? [],
              tocPlugin(headings)
            ];
            return opts;
          }
        });
        return [{ level: 1, title: doc.title }, ...headings];
      }
    },
    last_edited: { type: "date", resolve: getLastEditedDate("content") }
  },
  extensions: {}
}));
var tocPlugin = (headings) => () => {
  return (node) => {
    for (const element of node.children.filter(
      (child) => child.type === "heading"
    )) {
      const title = toMarkdown(
        { type: "paragraph", children: element.children },
        { extensions: [mdxToMarkdown()] }
      ).trim().replace(/<.*$/g, "").replace(/\\/g, "").trim();
      headings.push({
        level: element.depth,
        title
      });
    }
  };
};
var contentlayer_config_default = makeSource({
  contentDirPath: "content",
  documentTypes: [Post, Author, Log, Doc, CodePage],
  mdx: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      rehypeSlug,
      [rehypePrettyCode, { theme: "github-dark", keepBackground: true }],
      [
        rehypeAutolinkHeadings,
        {
          properties: {
            className: ["subheading-anchor"],
            ariaLabel: "Link to section"
          }
        }
      ]
    ]
  }
});
export {
  Author,
  CodePage,
  Doc,
  Log,
  Post,
  computeUrlFromFilePath,
  contentlayer_config_default as default,
  getLastEditedDate
};
//# sourceMappingURL=compiled-contentlayer-config-GWTRZ57P.mjs.map
