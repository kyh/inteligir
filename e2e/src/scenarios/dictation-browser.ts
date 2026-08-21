// Dictation, driven end to end in a real browser against a real server.
//
// WHAT IS REAL HERE AND WHAT IS NOT. Everything above the recognizer is real:
// the microphone permission, `getUserMedia`, the ScriptProcessor frames, the
// 16 kHz PCM conversion, the dictation WEBSOCKET, the route, the live partial
// and the insertion into the composer. Only the Parakeet recognizer is stood in
// for — the server runs with INTELIGIR_VOICE=scripted, whose partials and final
// NAME THE SAMPLE COUNT they received. That is what makes this an assertion
// rather than a click test: a partial appearing DURING the hold and a composer
// reading "scripted dictation of N samples" with N > 0 both prove the
// microphone's bytes are streaming the whole path.
//
// The alternative was a 32 MB model download inside CI, which would make the
// suite depend on a third-party host being up and on a decode that takes a
// different amount of time on every runner.
//
// THE MICROPHONE IS CHROME'S OWN FAKE DEVICE. `--use-fake-ui-for-media-stream`
// auto-grants the permission a headless browser would otherwise block, and
// `--use-fake-device-for-media-stream` generates a tone — so no audio fixture
// is committed, and the bytes are still genuinely captured rather than
// injected past the recorder.

import { setTimeout as delay } from "node:timers/promises";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("dictation");
const MOUNT_DEADLINE_MS = 90_000;
const TRANSCRIPT_DEADLINE_MS = 60_000;

const CHROME_MEDIA_ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
].join(",");

const COMPOSER = 'textarea[aria-label="Message the agent"]';
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
      await agentBrowser(["wait", ".cm-content"], MOUNT_DEADLINE_MS);
      await agentBrowser(["wait", COMPOSER], MOUNT_DEADLINE_MS);

      // The button reads its own status off /voice/status, so waiting for the
      // enabled label is also the assertion that the route answered.
      ctx.log("waiting for the mic button to report a usable runtime");
      await agentBrowser(["wait", MIC], MOUNT_DEADLINE_MS);

      ctx.log("recording");
      await agentBrowser(["click", MIC]);
      await agentBrowser(["wait", MIC_RECORDING], 30_000);

      // THE POINT OF STREAMING: the words appear as you speak. A live partial
      // shows in the preview BEFORE release, and scripted mode names the sample
      // count — so a matching partial proves the microphone's bytes are reaching
      // the server over the socket mid-hold, not just on stop.
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

      // THE POINT OF THE FEATURE: dictation is input. A transcript that
      // auto-sent would leave the composer empty and a thread holding a
      // message the user never read.
      ctx.log("asserting the transcript was inserted and NOT sent");
      await delay(1_000);
      const stillThere = await agentBrowser(["get", "value", COMPOSER]);
      expect(
        stillThere === composed,
        `the composer changed after the transcript landed: ${JSON.stringify(stillThere)}`,
      );
      const threads = await app.api.threads.list.$get({ query: {} });
      expect(threads.status === 200, `GET threads answered ${threads.status}`);
      const listed = await threads.json();
      expect(
        "threads" in listed && listed.threads.length === 0,
        `dictation created a thread: ${JSON.stringify(listed)}`,
      );

      // Typing after a dictation must continue from the caret the insertion
      // left, not from the start of the box.
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
