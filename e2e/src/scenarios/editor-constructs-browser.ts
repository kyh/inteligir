// Every live-preview construct rendered by a REAL browser over the real
// product, against one seeded note. The unit suite drives an EditorView under
// jsdom, which has no layout and no font metrics — so it can prove which
// ranges decorate but never that the widget survived the bundle, the CSP and a
// real measure pass. That is this scenario's whole job: the constructs are
// asserted through the DOM the browser actually built, and the buffer is
// re-read from disk afterwards to prove rendering wrote nothing.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, skip } from "../harness/assert";
import { exec, ExecError } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

const SESSION = `inteligir-e2e-editor-${process.pid}`;
const DOC_PATH = "Constructs.md";

const DOC = `# Constructs

Prose carrying #alpha and #nested/child, plus a literal \`#incode\` one.
`;

/** What one `eval` pass reports about the rendered editor: a named list of
 *  strings per construct, so adding a construct is one line of probe script
 *  and one assertion rather than another round trip and another parser. */
type RenderedProbe = Record<string, string[]>;

async function agentBrowser(args: readonly string[], timeoutMs = 60_000): Promise<string> {
  const result = await exec("agent-browser", ["--session", SESSION, ...args], { timeoutMs });
  return result.stdout.trim();
}

function describeExecError(error: unknown): string {
  if (error instanceof ExecError) {
    return [error.message, error.stdout.trim(), error.stderr.trim()]
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

// `get text <sel>` answers for the FIRST match only, so a construct that
// renders N times is read through one eval that reports all of them. The CLI
// serializes the returned value as JSON, so the script returns the object.
const PROBE_SCRIPT = `({
  tags: [...document.querySelectorAll('.cm-content .cm-tag')].map((n) => n.textContent),
})`;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRenderedProbe(value: unknown): value is RenderedProbe {
  if (typeof value !== "object" || value === null) return false;
  for (const key of Object.keys(value)) {
    const entry: unknown = Reflect.get(value, key);
    if (!isStringArray(entry)) return false;
  }
  return true;
}

/** Parse the eval answer, refusing anything that is not the probe's shape —
 *  a scenario that read `undefined` as "no chips" would pass a regression
 *  that deleted the whole extension. */
function parseProbe(raw: string): RenderedProbe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    expect(false, `the probe answer did not parse (${String(error)}):\n${raw}`);
  }
  expect(isRenderedProbe(parsed), `the probe answered an unexpected shape:\n${raw}`);
  return parsed;
}

/** One construct's rendered strings. Absent is a failure, never an empty list:
 *  the probe script and the assertions have to name the same field. */
function rendered(probe: RenderedProbe, field: string): string[] {
  const value = probe[field];
  expect(value !== undefined, `the probe reports no "${field}" field`);
  return value;
}

export const editorConstructsBrowser: Scenario = {
  name: "editor-constructs-browser",
  description: "every live-preview construct renders headless, and rendering writes no bytes",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      // The only root note, so the virgin boot opens it.
      seedVault: async (vaultDir) => {
        await writeFile(join(vaultDir, DOC_PATH), DOC, "utf8");
      },
    });

    try {
      ctx.log("probing the environment: can a headless browser launch at all?");
      try {
        await agentBrowser(["open", "about:blank"], 120_000);
      } catch (error) {
        skip(
          `agent-browser could not launch a headless browser in this environment; ` +
            `the exact error:\n${describeExecError(error)}`,
        );
      }

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", ".cm-content"], 90_000);
      await agentBrowser(["wait", ".cm-tag"], 30_000);

      const probe = parseProbe(await agentBrowser(["eval", PROBE_SCRIPT]));

      ctx.log("inline #tag chips");
      const tags = rendered(probe, "tags");
      expect(
        tags.join(" ") === "#alpha #nested/child",
        `the tag chips are exactly the index's tokens, got: ${JSON.stringify(tags)}`,
      );

      ctx.log("the file on disk is byte-identical after rendering");
      const onDisk = await readFile(join(app.vaultDir, DOC_PATH), "utf8");
      expect(onDisk === DOC, "rendering the note rewrote its bytes");
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
