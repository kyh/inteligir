// Every live-preview construct rendered by a REAL browser over the real
// product, against one seeded note. The unit suite drives an EditorView under
// jsdom, which has no layout and no font metrics — so it can prove which
// ranges decorate but never that the widget survived the bundle, the CSP and a
// real measure pass. That is this scenario's whole job: the constructs are
// asserted through the DOM the browser actually built, and the buffer is
// re-read from disk afterwards to prove rendering wrote nothing.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { apiPath, apiRoutes } from "@repo/server-contract/routes";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("editor");
const DOC_PATH = "Constructs.md";

const DOC = `# Constructs

Prose carrying #alpha and #nested/child, plus a literal \`#incode\` one.

> [!WARNING] Mind the gap
> A second line inside the same callout.

> An ordinary quote, which is not a callout.

Inline $a^2 + b^2 = c^2$ math, then a display block:

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

A broken $\\frobnicate{x}$ shows its own source.

![a diagram](assets/diagram.svg)

Refused: ![no](javascript:alert(1)).

\`\`\`mermaid
graph TD
  Buffer --> File
\`\`\`

\`\`\`mermaid
not a diagram this renderer can draw
\`\`\`

| Name | **Bold** | Right |
| --- | :---: | ---: |
| a \`code\` b | [link](https://x.dev) | 1 |
`;

const ASSET_PATH = "assets/diagram.svg";
const ASSET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>\n`;

/** What one `eval` pass reports about the rendered editor: a named list of
 *  strings per construct, so adding a construct is one line of probe script
 *  and one assertion rather than another round trip and another parser. */
type RenderedProbe = Record<string, string[]>;

// `get text <sel>` answers for the FIRST match only, so a construct that
// renders N times is read through one eval that reports all of them. The CLI
// serializes the returned value as JSON, so the script returns the object.
const PROBE_SCRIPT = `({
  tags: [...document.querySelectorAll('.cm-content .cm-tag')].map((n) => n.textContent),
  calloutLabels: [...document.querySelectorAll('.cm-content .cm-callout-label')]
    .map((n) => n.textContent + ':' + n.dataset.callout),
  calloutLines: [...document.querySelectorAll('.cm-content .cm-callout-line')]
    .map((n) => n.dataset.callout),
  math: [...document.querySelectorAll('.cm-content .cm-math')]
    .map((n) => (n.classList.contains('cm-math-display') ? 'display' : 'inline')
      + ':' + (n.querySelector('.katex') ? 'katex' : 'error')),
  mathErrors: [...document.querySelectorAll('.cm-content .cm-math-error-source')]
    .map((n) => n.textContent),
  images: [...document.querySelectorAll('.cm-content img.cm-image-img')]
    .map((n) => n.getAttribute('src') + ':'
      + (n.complete && n.naturalWidth > 0 ? 'loaded' : 'broken')),
  imageErrors: [...document.querySelectorAll('.cm-content .cm-image-error-message')]
    .map((n) => n.textContent),
  mermaid: [...document.querySelectorAll('.cm-content .cm-mermaid')]
    .map((n) => n.querySelector('svg') ? 'svg'
      : n.querySelector('.cm-mermaid-error') ? 'error' : 'pending'),
  mermaidLabels: [...document.querySelectorAll('.cm-content .cm-mermaid svg .node text')]
    .map((n) => n.textContent),
  tableHeaders: [...document.querySelectorAll('.cm-content .cm-table th')]
    .map((n) => n.textContent + ':' + n.style.textAlign),
  tableCells: [...document.querySelectorAll('.cm-content .cm-table td')]
    .map((n) => n.textContent),
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
        await mkdir(join(vaultDir, "assets"), { recursive: true });
        await writeFile(join(vaultDir, ASSET_PATH), ASSET_SVG, "utf8");
      },
    });

    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", ".cm-content"], 90_000);
      await agentBrowser(["wait", ".cm-tag"], 30_000);
      // The mermaid renderer is a lazy chunk, so its first fence paints after
      // a round trip; everything else is synchronous by the time it does.
      await agentBrowser(["wait", ".cm-mermaid svg"], 30_000);

      const probe = parseProbe(await agentBrowser(["eval", PROBE_SCRIPT]));

      ctx.log("inline #tag chips");
      const tags = rendered(probe, "tags");
      expect(
        tags.join(" ") === "#alpha #nested/child",
        `the tag chips are exactly the index's tokens, got: ${JSON.stringify(tags)}`,
      );

      ctx.log("callouts");
      expect(
        rendered(probe, "calloutLabels").join(" ") === "WARNING:warning",
        `the callout header folds to its label, got: ${JSON.stringify(rendered(probe, "calloutLabels"))}`,
      );
      expect(
        rendered(probe, "calloutLines").join(" ") === "warning warning",
        `both callout lines carry the box, and the plain quote none, got: ${JSON.stringify(rendered(probe, "calloutLines"))}`,
      );

      ctx.log("math");
      expect(
        rendered(probe, "math").join(" ") === "inline:katex display:katex inline:error",
        `KaTeX renders inline and display math, and a broken formula falls back, got: ${JSON.stringify(rendered(probe, "math"))}`,
      );
      expect(
        rendered(probe, "mathErrors").join(" ") === "$\\frobnicate{x}$",
        `the failed formula keeps its own source on screen, got: ${JSON.stringify(rendered(probe, "mathErrors"))}`,
      );

      ctx.log("images");
      expect(
        rendered(probe, "images").join(" ") ===
          `${apiPath(apiRoutes.vault.asset)}?path=assets%2Fdiagram.svg:loaded`,
        `the vault embed resolves through the asset route and the bytes arrive, got: ${JSON.stringify(rendered(probe, "images"))}`,
      );
      expect(
        rendered(probe, "imageErrors").join(" ") === "javascript: images are not loaded",
        `a javascript: src never reaches an <img>, got: ${JSON.stringify(rendered(probe, "imageErrors"))}`,
      );

      ctx.log("mermaid");
      expect(
        rendered(probe, "mermaid").join(" ") === "svg error",
        `a drawable fence becomes an SVG and an undrawable one falls back, got: ${JSON.stringify(rendered(probe, "mermaid"))}`,
      );
      expect(
        rendered(probe, "mermaidLabels").join(" ") === "Buffer File",
        `the diagram's own nodes are drawn, got: ${JSON.stringify(rendered(probe, "mermaidLabels"))}`,
      );

      ctx.log("tables");
      expect(
        rendered(probe, "tableHeaders").join(" ") === "Name:left Bold:center Right:right",
        `the header cells render with the delimiter row's alignment, got: ${JSON.stringify(rendered(probe, "tableHeaders"))}`,
      );
      expect(
        rendered(probe, "tableCells").join(" | ") === "a code b | link | 1",
        `each cell renders its own inline markdown, got: ${JSON.stringify(rendered(probe, "tableCells"))}`,
      );

      ctx.log("the file on disk is byte-identical after rendering");
      const onDisk = await readFile(join(app.vaultDir, DOC_PATH), "utf8");
      expect(onDisk === DOC, "rendering the note rewrote its bytes");
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
