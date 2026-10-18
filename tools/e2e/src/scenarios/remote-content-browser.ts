import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HTML_FRAME_PATH } from "@repo/contract/local/routes";
import { parseEval } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const DOC_PATH = "Remote.md";
const RAN = "inteligir-e2e-html-ran";
const RUN_DEADLINE_MS = 15_000;

// the block proves it ran by messaging the page: its frame's origin is opaque, so no probe reads in.
// The diagram comes after it, since a drawn diagram's source is a hidden <pre> and the wait below
// is for the html block's.
const DOC = `# Remote

![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)

![shot](https://example.com/shot.png)

\`\`\`inteligir-html
<!doctype html>
<p>a static first frame</p>
<script>document.addEventListener("DOMContentLoaded", () => { parent.postMessage("${RAN}", "*"); });</script>
\`\`\`

\`\`\`mermaid
graph TD;
A[Start]-->B[Picture];
click A "https://example.com/diagram-link"
B@{ img: "https://example.com/diagram.png", label: "Picture" }
\`\`\`
`;

// Pele's own class on the drawing it answers
const DIAGRAM = `${EDITOR} svg.pele`;

const PROBE = `JSON.stringify({
  cards: [...document.querySelectorAll('${EDITOR} p')].filter((p) => p.textContent === 'Web content, not loaded').length,
  diagramReferences: document.querySelectorAll('${DIAGRAM} a, ${DIAGRAM} image, ${DIAGRAM} [href]').length,
  diagrams: document.querySelectorAll('${DIAGRAM}').length,
  frames: document.querySelectorAll('${EDITOR} iframe').length,
  remoteImages: [...document.querySelectorAll('${EDITOR} img')].filter((img) => /^https?:/iu.test(img.getAttribute('src') ?? '')).length,
  remoteRequests: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => !name.startsWith(location.origin)),
})`;

const probeSchema = z.strictObject({
  cards: z.number(),
  diagramReferences: z.number(),
  diagrams: z.number(),
  frames: z.number(),
  remoteImages: z.number(),
  remoteRequests: z.array(z.string()),
});

const LISTEN = `(() => { window.inteligirHtmlRan = false; addEventListener('message', (event) => { if (event.data === '${RAN}') { window.inteligirHtmlRan = true; } }); return 'listening'; })()`;

const RAN_PROBE = "String(window.inteligirHtmlRan === true)";

const RUN_FRAME_SRC = `String(document.querySelector('${EDITOR} iframe[title="HTML run"]')?.getAttribute('src'))`;

// only the built bundle serves the CSP (`pnpm dev` stamps none), so this is the one place a live
// remote frame, or a Run that cannot run, shows up.
export const remoteContentBrowser: Scenario = {
  description:
    "under the built bundle's CSP a remote embed is an unloaded card, a diagram draws with neither its link nor its picture, and an html block's Run executes its script under its own policy",
  name: "remote-content-browser",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, DOC_PATH), DOC, "utf-8");
      },
    });
    const agentBrowser = await ctx.browser("remote-content");

    ctx.log(`opening ${app.baseUrl}/ on ${DOC_PATH}`);
    await agentBrowser.openWorkspace(app, {
      path: `/?item=${encodeURIComponent(DOC_PATH)}`,
      ready: EDITOR,
    });
    await agentBrowser(["wait", `${EDITOR} pre`], 30_000);
    // the diagram's renderer is a lazy chunk, so its drawing is what proves the chunk ran here
    await agentBrowser(["wait", DIAGRAM], 30_000);

    ctx.log(
      "the video and the image are cards, the diagram draws no link or picture, and nothing remote is loaded",
    );
    const probe = parseEval(await agentBrowser(["eval", PROBE]), probeSchema);
    expectEq(probe.cards, 2, "remote cards drawn");
    expectEq(probe.frames, 0, "frames mounted before Run");
    expectEq(probe.remoteImages, 0, "remote images mounted");
    expectEq(probe.diagrams, 1, "diagrams drawn");
    expectEq(probe.diagramReferences, 0, "links and pictures inside the diagram");
    expectEq(probe.remoteRequests, [], "requests that left the page's origin");

    ctx.log("Run loads the html frame, whose own policy lets the block's inline script run");
    expectEq(parseEval(await agentBrowser(["eval", LISTEN]), z.string()), "listening", "listener");
    await agentBrowser(["find", "role", "button", "click", "--name", "Run", "--exact"]);
    const src = parseEval(await agentBrowser(["eval", RUN_FRAME_SRC]), z.string());
    expect(src === HTML_FRAME_PATH, `the Run frame loaded ${src}, not ${HTML_FRAME_PATH}`);
    await pollUntil(
      async () => parseEval(await agentBrowser(["eval", RAN_PROBE]), z.string()),
      (ran) => ran === "true",
      {
        deadlineMs: RUN_DEADLINE_MS,
        describe: () => "the block's inline script never ran: the frame refused it",
      },
    );
  },
};
