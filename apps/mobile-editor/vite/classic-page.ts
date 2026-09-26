import type { Plugin } from "vite";

// WKWebView fetches a module script, and any tag marked crossorigin, in CORS mode, and a page
// loaded from file:// has no origin to answer one with (vitejs/vite#14483). So the page the phone
// loads from its own bundle is one classic script beside plain stylesheet links, and the build
// fails rather than emit anything else.

const ENTRY_TAG = /<(?:script|link)\b[^>]*>/gu;

const toClassicTag = (tag: string): string =>
  tag.replace(/\stype="module"/u, " defer").replaceAll(/\scrossorigin(?:="[^"]*")?/gu, "");

export const toClassicPage = (html: string): string => html.replaceAll(ENTRY_TAG, toClassicTag);

export const classicPageProblems = (html: string): string[] => {
  const problems: string[] = [];
  if (/\btype=["']?module\b/u.test(html)) {
    problems.push('a script is type="module", which a file:// page cannot load');
  }
  const scripts = html.match(/<script\b/gu)?.length ?? 0;
  if (scripts !== 1) {
    problems.push(`the page references ${String(scripts)} scripts, and it must load exactly one`);
  }
  if (/\scrossorigin\b/u.test(html)) {
    problems.push(
      "a tag is marked crossorigin, so its fetch is a CORS request file:// cannot answer",
    );
  }
  if (/\brel=["']?modulepreload\b/u.test(html)) {
    problems.push("a modulepreload link names a second chunk");
  }
  return problems;
};

export const classicPage = (): Plugin => ({
  apply: "build",
  enforce: "post",
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle)
      .filter((output) => output.type === "chunk")
      .map((chunk) => chunk.fileName);
    if (chunks.length !== 1) {
      this.error(
        `the phone editor page must build to one script, and it built ${String(chunks.length)}: ${chunks.slice(0, 5).join(", ")}`,
      );
    }
  },
  name: "classic-page",
  transformIndexHtml: {
    handler: (html) => {
      const page = toClassicPage(html);
      const problems = classicPageProblems(page);
      if (problems.length > 0) {
        throw new Error(
          `the phone editor page cannot load from file://:\n  ${problems.join("\n  ")}`,
        );
      }
      return page;
    },
    order: "post",
  },
});
