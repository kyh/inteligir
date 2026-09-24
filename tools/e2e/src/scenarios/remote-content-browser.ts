import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HTML_FRAME_PATH } from "@repo/api/local/routes";
import { parseEval } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const DOC_PATH = "Remote.md";
const RAN = "inteligir-e2e-html-ran";
const RUN_DEADLINE_MS = 15_000;

// the block proves it ran by messaging the page: its frame's origin is opaque, so no probe reads in.
const DOC = `# Remote

<video src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />

![shot](https://example.com/shot.png)

\`\`\`inteligir-html
<!doctype html>
<p>a static first frame</p>
<script>document.addEventListener("DOMContentLoaded", () => { parent.postMessage("${RAN}", "*"); });</script>
\`\`\`
`;

const PROBE = `JSON.stringify({
  cards: [...document.querySelectorAll('${EDITOR} p')].filter((p) => p.textContent === 'Remote content, not loaded').length,
  frames: document.querySelectorAll('${EDITOR} iframe').length,
  remoteImages: [...document.querySelectorAll('${EDITOR} img')].filter((img) => /^https?:/iu.test(img.getAttribute('src') ?? '')).length,
})`;

const probeSchema = z
  .object({ cards: z.number(), frames: z.number(), remoteImages: z.number() })
  .strict();

const LISTEN = `(() => { window.inteligirHtmlRan = false; addEventListener('message', (event) => { if (event.data === '${RAN}') { window.inteligirHtmlRan = true; } }); return 'listening'; })()`;

const RAN_PROBE = "String(window.inteligirHtmlRan === true)";

const RUN_FRAME_SRC = `String(document.querySelector('${EDITOR} iframe[title="HTML run"]')?.getAttribute('src'))`;

// only the built bundle serves the CSP (`pnpm dev` stamps none), so this is the one place a live
// remote frame, or a Run that cannot run, shows up.
export const remoteContentBrowser: Scenario = {
  description:
    "under the shipped CSP a remote embed is an unloaded card, and an html block's Run runs its script",
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
    await agentBrowser.openWorkspace(app, { path: `/?note=${encodeURIComponent(DOC_PATH)}` });
    await agentBrowser(["wait", `${EDITOR} pre`], 30_000);

    ctx.log("the video and the image are cards, and nothing remote is loaded");
    const probe = parseEval(await agentBrowser(["eval", PROBE]), probeSchema);
    expectEq(probe.cards, 2, "remote cards drawn");
    expectEq(probe.frames, 0, "frames mounted before Run");
    expectEq(probe.remoteImages, 0, "remote images mounted");

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
