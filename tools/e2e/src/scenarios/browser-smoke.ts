// Drives a real headless browser over the agent-browser CLI. The invariants:
// the page loads, the SPA mounts (sidebar + editor), the virgin boot opens
// the seeded welcome note, the page reaches the API, the palette shortcut
// does not edit the note under it, and the console stays clean. The editor is
// the Plate surface (`[data-slate-editor]`); a caret move alone must not
// serialize, so the chord check's byte-identity oracle still holds.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("smoke");
const MOUNT_DEADLINE_MS = 60_000;
/** Settle window between "the page reached the API" and the error sweep, so
 *  a late-arriving async failure cannot slip in after the assertion read. */
const QUIESCENCE_MS = 1_000;
/** Longer than the note's save debounce, so a buffer edit that the palette's
 *  focus steal did not already flush has still reached disk by the read. */
const SAVE_SETTLE_MS = 2_500;
/** The palette's root query box. Prefix-matched: the placeholder ends in an
 *  ellipsis that is awkward to quote through a shell. */
const PALETTE_INPUT = 'input[placeholder^="Search notes"]';
/** agent-browser drives a browser on THIS machine, so the running platform is
 *  the one the page sees — and the app claims ⌘ there, Ctrl elsewhere. */
const PALETTE_CHORD = process.platform === "darwin" ? "Meta+p" : "Control+p";

function pageIsMounted(bodyText: string): boolean {
  // The seeded welcome note's content only reaches the page through a
  // successful `vault.read` round trip; the sync pill proves the status
  // query ran. Together they prove the client bundle ran against this
  // instance's API. (The sidebar lists TITLES now — "Welcome", not
  // "Welcome.md" — so the content line is the sturdier witness.)
  return bodyText.includes("Welcome to inteligir") && bodyText.includes("Local only");
}

/**
 * The document the REAL build serves, asserted over the wire before a browser
 * touches it.
 *
 * This lives here rather than in a unit test because it is a claim about the
 * built artifact, and `pnpm verify` runs its tests BEFORE the build — a unit
 * test reading `dist/` asserts over the previous build's output.
 */
async function assertDocumentPolicy(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/`, { headers: { accept: "text/html" } });
  expect(response.ok, `GET / answered ${response.status}`);
  const policy = response.headers.get("content-security-policy") ?? "";
  expect(policy.length > 0, "the served document carries no content-security-policy");

  // `'self'` is the WHOLE script allowance, and it only works because a plain
  // SPA injects nothing at runtime — so an inline script in the shipped
  // document is a script the browser will refuse.
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

  // The browser's credential rides the document, because it is the one client
  // that cannot set a header for itself.
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

      // The regression this pins: the editor's keymap ALSO bound the palette
      // chord, so the palette opened over a note that had just had `[]()`
      // spliced into it. Disk is the oracle rather than the rendered text —
      // decorations move with the caret, bytes do not — and the palette
      // stealing focus flushes the editor, so a corrupted buffer WOULD land.
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
