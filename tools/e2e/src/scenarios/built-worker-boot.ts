import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, expectEq } from "../harness/assert";
import { buildProcessEnv, exec } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

// a cold vite build of the whole Worker; a cached one returns at once.
const BUILD_TIMEOUT_MS = 300_000;

const PRIVACY_DOC = path.join("docs", "privacy.md");

const GALLERY_HTML = path.join("apps", "web", "gallery.html");

// read from the page on every run, so a retitled gallery cannot leave this check hunting a stale
// literal
const htmlTitle = (html: string): string => {
  const title = /<title>(?<title>[^<]+)<\/title>/u.exec(html)?.groups?.title?.trim();
  expect(title !== undefined && title !== "", `${GALLERY_HTML} has no <title>`);
  return title;
};

interface PrivacyLandmarks {
  heading: string;
  sentence: string;
}

// read from the doc on every run, so a page holding a copy, or a cached build that missed an edit
// to the doc, answers with words the doc no longer has.
const privacyLandmarks = (doc: string): PrivacyLandmarks => {
  const lines = doc.split("\n");
  const headingAt = lines.findIndex((line) => line.startsWith("# "));
  const heading = lines[headingAt]?.slice("# ".length).trim();
  expect(heading !== undefined, `${PRIVACY_DOC} has no "# " heading for /privacy to render`);
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
  expect(sentence !== "", `${PRIVACY_DOC} has no paragraph under its heading`);
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
  description: "the vite-built Worker bundle boots under wrangler dev and answers its routes",
  name: "built-worker-boot",
  // the build's own budget plus a cold wrangler dev boot.
  timeoutMs: BUILD_TIMEOUT_MS + 180_000,
  async run(context) {
    // built through turbo, not looked for on disk: a present artifact may be stale and boot last
    // week's Worker.
    await exec("pnpm", ["turbo", "run", "build", "--filter=@repo/web"], {
      cwd: context.repoRoot,
      env: buildProcessEnv(),
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    const builtConfig = path.join(
      context.repoRoot,
      "apps",
      "web",
      "dist",
      "server",
      "wrangler.json",
    );
    expect(existsSync(builtConfig), `the web build emitted no ${builtConfig}`);

    const worker = await context.cloudWorker({ builtConfig });

    // a bundle whose module scope threw answers 500 to everything.
    const session = await fetch(`${worker.origin}/api/auth/get-session`, {
      headers: { origin: worker.origin },
    });
    expectEq(session.status, 200, "get-session against the built bundle");
    const account = await fetch(`${worker.origin}/v1/account`);
    expectEq(account.status, 401, "an unauthenticated device route against the built bundle");

    const { heading, sentence } = privacyLandmarks(
      await readFile(path.join(context.repoRoot, PRIVACY_DOC), "utf-8"),
    );
    const privacy = await fetch(`${worker.origin}/privacy`);
    expectEq(privacy.status, 200, "/privacy against the built bundle");
    const contentType = privacy.headers.get("content-type") ?? "";
    expect(contentType.startsWith("text/html"), `/privacy answered ${contentType}, not text/html`);
    const html = await privacy.text();
    const renderedHeading = /<h1\b[^>]*>(?<heading>.*?)<\/h1>/su.exec(html)?.groups?.heading;
    expectEq(
      pageWords(renderedHeading ?? ""),
      docWords(heading),
      `/privacy's <h1> against ${PRIVACY_DOC}'s heading`,
    );
    expect(
      ` ${pageWords(html)} `.includes(` ${docWords(sentence)} `),
      `/privacy does not carry ${PRIVACY_DOC}'s first sentence ("${sentence}")\n` +
        `  rule: the page renders the doc itself, and turbo rebuilds it only for an input apps/web/turbo.json names`,
    );

    const unknown = await fetch(`${worker.origin}/no-route-answers-this`);
    expectEq(unknown.status, 404, "an unknown path against the built bundle");
    const design = await fetch(`${worker.origin}/design`);
    expectEq(design.status, unknown.status, "/design against the built bundle, as an unknown path");
    const galleryTitle = htmlTitle(
      await readFile(path.join(context.repoRoot, GALLERY_HTML), "utf-8"),
    );
    const assetsDir = path.join(context.repoRoot, "apps", "web", "dist", "client", "assets");
    const carriers: string[] = [];
    for (const name of await readdir(assetsDir)) {
      const asset = await readFile(path.join(assetsDir, name), "utf-8");
      if (asset.includes(galleryTitle)) {
        carriers.push(name);
      }
    }
    expect(
      carriers.length === 0,
      `built assets carry the gallery's title ("${galleryTitle}"): ${carriers.join(", ")}\n` +
        `  rule: the gallery is ${GALLERY_HTML}, served by pnpm dev:gallery alone, never a route`,
    );
  },
};
