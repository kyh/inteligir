// INTELIGIR_VOICE=scripted stands in for the recognizer alone (the real model is a ~100 MB download
// from a third-party host); its partials name the sample count received, so a match proves the
// mic's bytes streamed the whole path.

import { setTimeout as delay } from "node:timers/promises";
import { modChord } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { COMPOSER } from "../harness/selectors";

const MOUNT_DEADLINE_MS = 90_000;
const TRANSCRIPT_DEADLINE_MS = 60_000;

// chrome's own fake device: the first flag auto-grants the permission headless would block, the
// second generates a tone, so no audio fixture is committed and the bytes are still captured.
const CHROME_MEDIA_ARGS = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];

const MIC = 'button[aria-label="Dictate"]';
const MIC_RECORDING = 'button[aria-label="Stop dictating"]';
const PREVIEW = "[data-dictation-preview]";
const TRANSCRIPT = /scripted dictation of (?<samples>\d+) samples/u;

export const dictationBrowser: Scenario = {
  description: "the composer's mic captures, transcribes and inserts — never sends",
  name: "dictation-browser",
  async run(ctx) {
    const app = await ctx.boot({ extraEnv: { INTELIGIR_VOICE: "scripted" }, name: "solo" });
    const agentBrowser = await ctx.browser("dictation");

    ctx.log(`opening ${app.baseUrl}/ with a fake microphone`);
    await agentBrowser.openWorkspace(app, { launchArgs: CHROME_MEDIA_ARGS });
    // the composer is behind ⌘K.
    await agentBrowser(["press", modChord("k")]);
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
    await pollUntil(
      async () => await agentBrowser(["get", "text", PREVIEW]),
      (preview) => TRANSCRIPT.test(preview),
      {
        deadlineMs: TRANSCRIPT_DEADLINE_MS,
        describe: (preview) =>
          `no live partial appeared during the hold; the preview holds ${JSON.stringify(preview)}`,
        intervalMs: 300,
      },
    );

    ctx.log("releasing, then waiting for the final to land in the composer");
    await agentBrowser(["click", MIC_RECORDING]);
    const composed = await pollUntil(
      async () => await agentBrowser(["get", "value", COMPOSER]),
      (value) => TRANSCRIPT.test(value),
      {
        deadlineMs: TRANSCRIPT_DEADLINE_MS,
        describe: (value) =>
          `no final transcript reached the composer; it holds ${JSON.stringify(value)}`,
        intervalMs: 500,
      },
    );

    const samples = Number(TRANSCRIPT.exec(composed)?.groups?.samples ?? "0");
    expect(
      samples > 0,
      `the transcript claims ${samples} samples — the microphone's bytes did not reach the server`,
    );

    // an auto-sent transcript would leave a thread holding a message the user never read.
    ctx.log("asserting the transcript was inserted and NOT sent");
    await delay(1000);
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
  },
};
