// An item's body conventions: the embeds and links a writer adds are spelled exactly as the editor
// serializes them, so an item opens rich and its first edit is a minimal diff. It renders through
// mdast-util-to-markdown, so the contract never imports it.

import type { Image, Link, Root } from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";

import { frontmatterEnd } from "../markdown/frontmatter";
import { MD_PROCESSOR, MD_STRINGIFY } from "../markdown/md-plugins";
import { BOM } from "../markdown/parsed-offsets";

// toMarkdown terminates with one newline; a fragment carries none
const render = (node: Image | Link): string => {
  const root: Root = { children: [{ children: [node], type: "paragraph" }], type: "root" };
  return toMarkdown(root, {
    ...MD_STRINGIFY,
    extensions: MD_PROCESSOR.data("toMarkdownExtensions") ?? [],
  }).replace(/\n$/u, "");
};

// `![](assets/x.png)`, `![](<assets/a b.pdf>)`: an embed with empty alt, as the editor writes it
export const embedMarkdown = (path: string): string =>
  render({ alt: "", type: "image", url: path });

// `[Copy of the page](assets/pages/x.html)`
export const linkMarkdown = (text: string, path: string): string =>
  render({ children: [{ type: "text", value: text }], type: "link", url: path });

const bodyStart = (content: string): number =>
  frontmatterEnd(content) ?? (content.startsWith(BOM) ? BOM.length : 0);

// the editor writes one blank line between a frontmatter block and the body after it
// (packages/editor's canonical/frontmatter-*.md fixtures), so a writer does too and a reader
// takes it as the block's, never the body's
const SEPARATING_LINE = /^\r?\n/u;

// the text after the frontmatter block and the blank line under it; "" when there is none
export const bodyOf = (content: string): string => {
  const body = content.slice(bodyStart(content));
  return frontmatterEnd(content) === null ? body : body.replace(SEPARATING_LINE, "");
};

// the frontmatter's bytes kept exactly and the body (as bodyOf answers it) replaced, one blank line
// under the block as the editor writes it; an empty body leaves the block alone
export const withBody = (content: string, body: string): string => {
  const head = content.slice(0, bodyStart(content));
  if (body === "" || frontmatterEnd(content) === null) {
    return `${head}${body}`;
  }
  const eol = head.endsWith("\r\n") ? "\r\n" : "\n";
  return `${head.endsWith("\n") ? head : `${head}${eol}`}${eol}${body}`;
};

const COPY_LINK_TEXT = "Copy of the page";

// a part without the blank lines around it
const trimPart = (part: string): string => part.replace(/^(?:[ \t]*\r?\n)+/u, "").trimEnd();

// a url item's body: its cover, the person's note, the article, then the page copy's link, each
// a paragraph apart, ending with one newline; "" when every part is empty
export const composeLinkBody = (parts: {
  cover: string | null;
  note: string;
  article: string;
  copy: string | null;
}): string => {
  const joined = [
    parts.cover === null ? "" : embedMarkdown(parts.cover),
    trimPart(parts.note),
    trimPart(parts.article),
    parts.copy === null ? "" : linkMarkdown(COPY_LINK_TEXT, parts.copy),
  ]
    .filter((part) => part !== "")
    .join("\n\n");
  return joined === "" ? "" : `${joined}\n`;
};
