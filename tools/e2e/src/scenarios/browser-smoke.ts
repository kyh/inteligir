import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("smoke");
const MOUNT_DEADLINE_MS = 60_000;
// a late async failure must not slip in after the error sweep.
const QUIESCENCE_MS = 1_000;
// longer than the note's save debounce, so a corrupted buffer has reached disk by the read.
const SAVE_SETTLE_MS = 2_500;
// prefix-matched: the placeholder ends in an ellipsis that is awkward to quote through a shell.
const PALETTE_INPUT = 'input[placeholder^="Search notes"]';
// agent-browser drives a browser on this machine, so the page sees this platform's modifier.
const PALETTE_CHORD = process.platform === "darwin" ? "Meta+p" : "Control+p";

function pageIsMounted(bodyText: string): boolean {
  // the welcome content only arrives through a vault.read round trip; the sync pill proves the
  // status query ran.
  return bodyText.includes("Welcome to inteligir") && bodyText.includes("Local only");
}

// here, not a unit test: `pnpm verify` runs tests before the build, so a unit test over dist/ reads
// the previous build.
async function assertDocumentPolicy(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/`, { headers: { accept: "text/html" } });
  expect(response.ok, `GET / answered ${response.status}`);
  const policy = response.headers.get("content-security-policy") ?? "";
  expect(policy.length > 0, "the served document carries no content-security-policy");

  // 'self' is the whole script allowance, so an inline script in the shipped document is one the
  // browser refuses.
  expect(
    policy.includes("script-src 'self'"),
    `the policy does not admit the bundle's own script: ${policy}`,
  );
  const html = await response.text();
  const inline = (html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gu) ?? []).filter(
    (tag) => !tag.includes("application/json"),
  );
  expect(
    inline.length === 0,
    `the built document carries inline scripts this policy refuses:\n${inline.join("\n")}`,
  );

  // the browser is the one client that cannot set a header for itself.
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(
    cookie.includes("HttpOnly") && cookie.includes("SameSite=Strict"),
    `the document did not hand the browser its device token: ${cookie}`,
  );
}

export const browserSmoke: Scenario = {
  name: "browser-smoke",
  description:
    "the page renders headless: title, SPA mount, API reached, palette chord safe, clean console",
  async run(ctx) {
    const app = await ctx.boot({ name: "solo" });
    try {
      ctx.log("asserting the served document carries the real policy");
      await assertDocumentPolicy(app.baseUrl);

      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);

      ctx.log("waiting for the SPA to mount");
      await agentBrowser(["wait", '[data-slot="sidebar-wrapper"]'], 90_000);

      ctx.log("waiting for the virgin-boot note to open in the editor");
      await agentBrowser(["wait", '[data-slate-editor="true"]'], 90_000);

      const title = await agentBrowser(["get", "title"]);
      expect(title === "inteligir", `document title is ${JSON.stringify(title)}`);

      ctx.log("waiting for the page to reach the API");
      const deadline = Date.now() + MOUNT_DEADLINE_MS;
      for (;;) {
        const body = await agentBrowser(["get", "text", "body"]);
        if (pageIsMounted(body)) {
          break;
        }
        expect(
          Date.now() < deadline,
          `the SPA never reached the API; body text:\n${body.slice(0, 2_000)}`,
        );
        await delay(500);
      }

      // disk is the oracle, not rendered text: decorations move with the caret, bytes do not, and
      // the palette's focus steal flushes the editor, so a corrupted buffer would land.
      ctx.log("the palette chord opens the palette without editing the note under it");
      const welcomeFile = join(app.vaultDir, "Welcome.md");
      const beforeChord = await readFile(welcomeFile, "utf8");
      await agentBrowser(["click", '[data-slate-editor="true"]']);
      await agentBrowser(["press", "End"]);
      await agentBrowser(["press", PALETTE_CHORD]);
      await agentBrowser(["wait", PALETTE_INPUT], 30_000);
      await agentBrowser(["press", "Escape"]);
      await delay(SAVE_SETTLE_MS);
      const afterChord = await readFile(welcomeFile, "utf8");
      expect(
        afterChord === beforeChord,
        `${PALETTE_CHORD} changed Welcome.md on disk:\n${JSON.stringify(afterChord)}`,
      );

      ctx.log("settling, then sweeping for page and console errors");
      await delay(QUIESCENCE_MS);
      const settledBody = await agentBrowser(["get", "text", "body"]);
      expect(pageIsMounted(settledBody), "the page stays mounted through the settle window");

      const pageErrors = await agentBrowser(["errors"]);
      expect(
        pageErrors.length === 0 || /^no /iu.test(pageErrors),
        `page errors were raised:\n${pageErrors}`,
      );
      const consoleOutput = await agentBrowser(["console"]);
      const errorLines = consoleOutput
        .split("\n")
        .filter((line) => /^\s*\[?err(or)?\]?\b/iu.test(line));
      expect(errorLines.length === 0, `console errors were logged:\n${errorLines.join("\n")}`);
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
