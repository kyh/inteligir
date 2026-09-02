// INTELIGIR_VOICE=scripted stands in for the recognizer alone (the real model is a ~100 MB download
// from a third-party host); its partials name the sample count received, so a match proves the
// mic's bytes streamed the whole path.

import { setTimeout as delay } from "node:timers/promises";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("dictation");
const MOUNT_DEADLINE_MS = 90_000;
const TRANSCRIPT_DEADLINE_MS = 60_000;

// chrome's own fake device: the first flag auto-grants the permission headless would block, the
// second generates a tone, so no audio fixture is committed and the bytes are still captured.
const CHROME_MEDIA_ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
].join(",");

const COMPOSER = 'textarea[aria-label="Ask the agent"]';
const MIC = 'button[aria-label="Dictate"]';
const MIC_RECORDING = 'button[aria-label="Stop dictating"]';
const PREVIEW = "[data-dictation-preview]";
const TRANSCRIPT = /scripted dictation of (\d+) samples/u;

export const dictationBrowser: Scenario = {
  name: "dictation-browser",
  description: "the composer's mic captures, transcribes and inserts — never sends",
  async run(ctx) {
    const app = await ctx.boot({ name: "solo", extraEnv: { INTELIGIR_VOICE: "scripted" } });
    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/ with a fake microphone`);
      await agentBrowser(["--args", CHROME_MEDIA_ARGS, "open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", '[data-slate-editor="true"]'], MOUNT_DEADLINE_MS);
      // the composer is behind ⌘K.
      await agentBrowser(["press", process.platform === "darwin" ? "Meta+k" : "Control+k"]);
      await agentBrowser(["wait", COMPOSER], MOUNT_DEADLINE_MS);

      // the button reads /voice/status, so waiting for its label also asserts the route answered.
      ctx.log("waiting for the mic button to report a usable runtime");
      await agentBrowser(["wait", MIC], MOUNT_DEADLINE_MS);

      ctx.log("recording");
      await agentBrowser(["click", MIC]);
      await agentBrowser(["wait", MIC_RECORDING], 30_000);

      // a partial before release proves the bytes reach the server mid-hold, not only on stop.
      ctx.log("waiting for a live partial during the hold");
      await agentBrowser(["wait", PREVIEW], 30_000);
      const partialDeadline = Date.now() + TRANSCRIPT_DEADLINE_MS;
      for (;;) {
        const preview = await agentBrowser(["get", "text", PREVIEW]);
        if (TRANSCRIPT.test(preview)) {
          break;
        }
        expect(
          Date.now() < partialDeadline,
          `no live partial appeared during the hold; the preview holds ${JSON.stringify(preview)}`,
        );
        await delay(300);
      }

      ctx.log("releasing, then waiting for the final to land in the composer");
      await agentBrowser(["click", MIC_RECORDING]);
      const deadline = Date.now() + TRANSCRIPT_DEADLINE_MS;
      let composed = "";
      for (;;) {
        composed = await agentBrowser(["get", "value", COMPOSER]);
        if (TRANSCRIPT.test(composed)) {
          break;
        }
        expect(
          Date.now() < deadline,
          `no final transcript reached the composer; it holds ${JSON.stringify(composed)}`,
        );
        await delay(500);
      }

      const samples = Number(TRANSCRIPT.exec(composed)?.[1] ?? "0");
      expect(
        samples > 0,
        `the transcript claims ${samples} samples — the microphone's bytes did not reach the server`,
      );

      // an auto-sent transcript would leave a thread holding a message the user never read.
      ctx.log("asserting the transcript was inserted and NOT sent");
      await delay(1_000);
      const stillThere = await agentBrowser(["get", "value", COMPOSER]);
      expect(
        stillThere === composed,
        `the composer changed after the transcript landed: ${JSON.stringify(stillThere)}`,
      );
      const listed = await app.api.threads.list();
      expect(listed.threads.length === 0, `dictation created a thread: ${JSON.stringify(listed)}`);

      ctx.log("typing continues after the inserted text");
      await agentBrowser(["type", COMPOSER, " and more"]);
      const appended = await agentBrowser(["get", "value", COMPOSER]);
      expect(
        appended === `${composed} and more`,
        `typing did not continue from the caret: ${JSON.stringify(appended)}`,
      );
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
