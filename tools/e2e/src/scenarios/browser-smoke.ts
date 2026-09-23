import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { agentBrowserSession, closeQuietly, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { AppInstance } from "../harness/instance";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("smoke");
const freshBrowser = agentBrowserSession("smoke-signed-out");
const MOUNT_DEADLINE_MS = 60_000;
// a late async failure must not slip in after the error sweep.
const QUIESCENCE_MS = 1000;
// longer than the note's save debounce, so a corrupted buffer has reached disk by the read.
const SAVE_SETTLE_MS = 2500;
// prefix-matched: the placeholder ends in an ellipsis that is awkward to quote through a shell.
const PALETTE_INPUT = 'input[placeholder^="Search notes"]';
// agent-browser drives a browser on this machine, so the page sees this platform's modifier.
const PALETTE_CHORD = process.platform === "darwin" ? "Meta+p" : "Control+p";
// the one thing the signed-out page must say: the command that signs a browser in.
const SIGNED_OUT_NAMES = "inteligir open";

const pageIsMounted = (bodyText: string): boolean =>
  // the welcome content only arrives through a vault.read round trip; the sync pill proves the
  // status query ran.
  bodyText.includes("Welcome to inteligir") && bodyText.includes("Local only");

// here, not a unit test: `pnpm verify` runs tests before the build, so a unit test over dist/ reads
// the previous build.
const assertDocumentPolicy = async (app: AppInstance): Promise<void> => {
  // a plain GET is anything on this machine; only a handoff a holder of the bearer minted signs a
  // browser in.
  const bare = await fetch(`${app.baseUrl}/`, { headers: { accept: "text/html" } });
  expect(bare.status === 401, `a plain GET / answered ${bare.status}, not the signed-out page`);
  const leaked = bare.headers.get("set-cookie");
  expect(leaked === null, `a plain GET / handed out a session cookie: ${String(leaked)}`);
  const signedOut = await bare.text();
  expect(
    signedOut.includes(SIGNED_OUT_NAMES),
    `the signed-out page does not name \`${SIGNED_OUT_NAMES}\`:\n${signedOut}`,
  );

  const handoff = await fetch(await app.browserUrl("/"), { redirect: "manual" });
  expect(
    handoff.status === 303 && handoff.headers.get("location") === `${app.baseUrl}/`,
    `the handoff answered ${handoff.status} to ${String(handoff.headers.get("location"))}`,
  );
  const cookie = handoff.headers.get("set-cookie") ?? "";
  expect(
    cookie.includes("HttpOnly") && cookie.includes("SameSite=Strict"),
    `the handoff did not hand the browser its session cookie: ${cookie}`,
  );

  const [session = ""] = cookie.split(";");
  const response = await fetch(`${app.baseUrl}/`, {
    headers: { accept: "text/html", cookie: session },
  });
  expect(response.ok, `GET / with the session cookie answered ${response.status}`);
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
};

// in a browser of its own: its cookie jar starts empty, and the signed-out page's own 401 load
// stays out of the console the main session sweeps.
const assertSignedOutJourney = async (
  app: AppInstance,
  repoRoot: string,
  log: (message: string) => void,
): Promise<void> => {
  log(`a fresh browser opening the bare ${app.baseUrl}/ gets the signed-out page`);
  await freshBrowser(["open", `${app.baseUrl}/`], 60_000);
  const signedOut = await freshBrowser(["get", "text", "body"]);
  expect(
    signedOut.includes(SIGNED_OUT_NAMES),
    `the bare URL did not show the signed-out page:\n${signedOut.slice(0, 2000)}`,
  );

  log("the link `inteligir open --json` prints signs that browser in");
  const opened = await exec(
    path.join(repoRoot, "apps", "cli", "bin", "inteligir"),
    ["open", "--json"],
    {
      env: { ...hermeticProcessEnv(), INTELIGIR_DATA_DIR: app.dataDir },
      timeoutMs: 60_000,
    },
  );
  const { url } = z.object({ url: z.string() }).parse(JSON.parse(opened.stdout));
  await freshBrowser(["open", url], 60_000);
  await freshBrowser(["wait", '[data-slot="sidebar-wrapper"]'], 90_000);
};

export const browserSmoke: Scenario = {
  description:
    "the page renders headless: signed-out page, `inteligir open` sign-in, title, SPA mount, API reached, palette chord safe, clean console",
  name: "browser-smoke",
  async run(ctx) {
    const app = await ctx.boot({ name: "solo" });
    try {
      ctx.log("asserting the served document carries the real policy");
      await assertDocumentPolicy(app);

      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      await assertSignedOutJourney(app, ctx.repoRoot, ctx.log);
      await closeQuietly(freshBrowser);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", await app.browserUrl("/")], 60_000);

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
          `the SPA never reached the API; body text:\n${body.slice(0, 2000)}`,
        );
        await delay(500);
      }

      // disk is the oracle, not rendered text: decorations move with the caret, bytes do not, and
      // the palette's focus steal flushes the editor, so a corrupted buffer would land.
      ctx.log("the palette chord opens the palette without editing the note under it");
      const welcomeFile = path.join(app.vaultDir, "Welcome.md");
      const beforeChord = await readFile(welcomeFile, "utf-8");
      await agentBrowser(["click", '[data-slate-editor="true"]']);
      await agentBrowser(["press", "End"]);
      await agentBrowser(["press", PALETTE_CHORD]);
      await agentBrowser(["wait", PALETTE_INPUT], 30_000);
      await agentBrowser(["press", "Escape"]);
      await delay(SAVE_SETTLE_MS);
      const afterChord = await readFile(welcomeFile, "utf-8");
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
        .filter((line) => /^\s*\[?err(?:or)?\]?\b/iu.test(line));
      expect(errorLines.length === 0, `console errors were logged:\n${errorLines.join("\n")}`);
    } finally {
      await closeQuietly(freshBrowser);
      await closeQuietly(agentBrowser);
    }
  },
};
