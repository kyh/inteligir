import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, expectEq } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import type { Scenario } from "../harness/scenario";

// each page renders its doc itself, so the doc is the page's words
const DOC_PAGES = [
  { doc: path.join("docs", "privacy.md"), route: "/privacy" },
  { doc: path.join("docs", "terms.md"), route: "/terms" },
] as const;

// what someone deciding whether to download reads
const LANDING_CTA = "Download for Mac";
const LANDING_REQUIREMENTS = ["Apple silicon", "a paid Claude plan or any ChatGPT plan"];

const BUILDER_CONFIG = path.join("apps", "desktop", "electron-builder.yml");
const LATEST_DOWNLOAD = "https://github.com/kyh/inteligir/releases/latest/download/";
const DMG_MACROS = new Map([
  ["arch", "arm64"],
  ["ext", "dmg"],
]);

// the dmg's name as electron-builder writes it for the one arch the app ships, read from the
// builder's config so a rename there fails here rather than as a 404 behind the button
const dmgName = (config: string): string => {
  const block = /^dmg:\n(?<body>(?:[ \t].*\n|\n)*)/mu.exec(config)?.groups?.body ?? "";
  const pattern = /^\s+artifactName:\s*(?<name>\S+)\s*$/mu.exec(block)?.groups?.name;
  expect(pattern !== undefined, `${BUILDER_CONFIG} gives the dmg no artifactName of its own`);
  expect(
    !/\$\{version\}/u.test(pattern),
    `${BUILDER_CONFIG} names the dmg with its version, which releases/latest/download cannot know`,
  );
  return pattern.replaceAll(
    /\$\{(?<macro>\w+)\}/gu,
    (whole, macro: string) => DMG_MACROS.get(macro) ?? whole,
  );
};

const ctaHref = (html: string): string | undefined =>
  /<a\b[^>]*href="(?<href>[^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*Download for Mac/u.exec(html)?.groups
    ?.href;

interface DocLandmarks {
  heading: string;
  sentence: string;
}

// read from the doc on every run, so a page holding a copy, or a cached build that missed an edit
// to the doc, answers with words the doc no longer has.
const docLandmarks = (doc: string, page: (typeof DOC_PAGES)[number]): DocLandmarks => {
  const lines = doc.split("\n");
  const headingAt = lines.findIndex((line) => line.startsWith("# "));
  const heading = lines[headingAt]?.slice("# ".length).trim();
  expect(heading !== undefined, `${page.doc} has no "# " heading for ${page.route} to render`);
  const paragraph: string[] = [];
  for (const line of lines.slice(headingAt + 1)) {
    if (line.trim() !== "") {
      paragraph.push(line.trim());
    } else if (paragraph.length > 0) {
      break;
    }
  }
  const text = paragraph.join(" ");
  const stop = /[.!?](?:\s|$)/u.exec(text);
  const sentence = stop === null ? text : text.slice(0, stop.index + 1);
  expect(sentence !== "", `${page.doc} has no paragraph under its heading`);
  return { heading, sentence };
};

// words alone, so markdown's markers and a link's url, React's entity escapes and the paragraph's
// line breaks read the same on both sides.
const wordsOf = (text: string): string =>
  text
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();

const docWords = (markdown: string): string => wordsOf(markdown.replaceAll(/\]\([^)]*\)/gu, " "));

// a script's body is left out, so a sentence the bundle carries but the render dropped is not read
// as on the page.
const pageWords = (html: string): string =>
  wordsOf(html.replaceAll(/<script\b[\s\S]*?<\/script>|<[^>]*>|&#?\w+;/giu, " "));

export const builtWorkerBoot: Scenario = {
  description: "the built Worker bundle boots under Miniflare and answers its routes",
  name: "built-worker-boot",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(context) {
    const worker = await context.cloudWorker();

    // a bundle whose module scope threw answers 500 to everything.
    const session = await fetch(`${worker.origin}/api/auth/get-session`, {
      headers: { origin: worker.origin },
    });
    expectEq(session.status, 200, "get-session against the built bundle");
    const account = await fetch(`${worker.origin}/v1/account`);
    expectEq(account.status, 401, "an unauthenticated device route against the built bundle");

    for (const page of DOC_PAGES) {
      const { heading, sentence } = docLandmarks(
        await readFile(path.join(context.repoRoot, page.doc), "utf-8"),
        page,
      );
      const response = await fetch(`${worker.origin}${page.route}`);
      expectEq(response.status, 200, `${page.route} against the built bundle`);
      const contentType = response.headers.get("content-type") ?? "";
      expect(
        contentType.startsWith("text/html"),
        `${page.route} answered ${contentType}, not text/html`,
      );
      const html = await response.text();
      const renderedHeading = /<h1\b[^>]*>(?<heading>.*?)<\/h1>/su.exec(html)?.groups?.heading;
      expectEq(
        pageWords(renderedHeading ?? ""),
        docWords(heading),
        `${page.route}'s <h1> against ${page.doc}'s heading`,
      );
      expect(
        ` ${pageWords(html)} `.includes(` ${docWords(sentence)} `),
        `${page.route} does not carry ${page.doc}'s first sentence ("${sentence}")\n` +
          `  rule: the page renders the doc itself, and turbo rebuilds it only for an input apps/web/turbo.json names`,
      );
    }

    const landing = await fetch(`${worker.origin}/`);
    expectEq(landing.status, 200, "/ against the built bundle");
    const landingHtml = await landing.text();
    const landingWords = ` ${pageWords(landingHtml)} `;
    for (const phrase of [LANDING_CTA, ...LANDING_REQUIREMENTS]) {
      expect(
        landingWords.includes(` ${wordsOf(phrase)} `),
        `/ does not say "${phrase}"\n  rule: the landing page names what the app needs before anyone downloads it`,
      );
    }
    const dmg = dmgName(await readFile(path.join(context.repoRoot, BUILDER_CONFIG), "utf-8"));
    expectEq(
      ctaHref(landingHtml),
      `${LATEST_DOWNLOAD}${dmg}`,
      `the Download button's link against the dmg ${BUILDER_CONFIG} names`,
    );

    const unknown = await fetch(`${worker.origin}/no-route-answers-this`);
    expectEq(unknown.status, 404, "an unknown path against the built bundle");
    const design = await fetch(`${worker.origin}/design`);
    expectEq(design.status, unknown.status, "/design against the built bundle, as an unknown path");
  },
};
