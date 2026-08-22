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
  // successful /api/v1/vault/file round trip; the sidebar row proves the
  // tree query ran. Together they prove the client bundle ran against this
  // instance's API.
  return bodyText.includes("Welcome") && bodyText.includes("Welcome.md");
}

/**
 * The document the REAL build serves, asserted over the wire before a browser
 * touches it. Prod only: the dev fallback is vite's middleware, which carries
 * no policy.
 *
 * This lives here rather than in a unit test because it is a claim about the
 * built artifact, and `pnpm verify` runs its tests BEFORE the build — a unit
 * test reading `dist/` asserts over the previous build's output.
 */
async function assertDocumentCarriesItsNonce(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/`, { headers: { accept: "text/html" } });
  expect(response.ok, `GET / answered ${response.status}`);
  const policy = response.headers.get("content-security-policy");
  expect(policy !== null, "the prod document carries no content-security-policy");
  const nonce = /'nonce-([^']+)'/u.exec(policy ?? "")?.[1];
  expect(nonce !== undefined, `no nonce in the policy: ${policy ?? "(none)"}`);
  const html = await response.text();

  // A script the policy does not admit is a script the browser refuses, so
  // every one of them has to carry THIS response's nonce.
  const unnonced = (html.match(/<script\b[^>]*>/gu) ?? []).filter(
    (tag) => !tag.includes(`nonce="${nonce ?? ""}"`) && !tag.includes(`nonce='${nonce ?? ""}'`),
  );
  expect(
    unnonced.length === 0,
    `scripts served without the document's nonce:\n${unnonced.join("\n")}`,
  );

  // The client router reads the nonce back from this meta and stamps it onto
  // everything it injects after hydration; without it those go out bare.
  expect(
    html.includes('property="csp-nonce"') && html.includes(`content="${nonce ?? ""}"`),
    'the document does not republish its nonce as <meta property="csp-nonce">',
  );
}

export const browserSmoke: Scenario = {
  name: "browser-smoke",
  description:
    "the page renders headless: title, SPA mount, API reached, palette chord safe, clean console",
  async run(ctx) {
    const app = await ctx.boot({ name: "solo" });
    try {
      if (ctx.mode === "prod") {
        ctx.log("asserting the served document carries the nonce its policy names");
        await assertDocumentCarriesItsNonce(app.baseUrl);
      }

      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);

      ctx.log("waiting for the SPA to mount");
      await agentBrowser(["wait", "aside"], 90_000);

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
