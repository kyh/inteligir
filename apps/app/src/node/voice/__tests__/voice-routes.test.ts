// The voice rows over the wire, through the composed app and the typed client
// — so the request encoding, the contract's own schemas and the status each
// refusal answers with are all exercised together rather than asserted about.

import {
  VOICE_BYTES_PER_SAMPLE,
  VOICE_MAX_AUDIO_BYTES,
  voiceStatusResponseSchema,
  voiceTranscribeResponseSchema,
} from "@repo/server-contract/voice";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";

/** Base64 of `sampleCount` silent Int16 samples — the shape the wire wants. */
function silence(sampleCount: number): string {
  return Buffer.alloc(sampleCount * VOICE_BYTES_PER_SAMPLE).toString("base64");
}

describe("the voice routes", () => {
  it("answers a status the contract's own schema accepts", async () => {
    const { client } = await bootTestApp();
    const response = await client.voice.status.$get();
    expect(response.status).toBe(200);
    expect(voiceStatusResponseSchema.parse(await response.json())).toEqual({
      state: "ready",
      model: { id: "scripted", label: "Scripted (test runtime)", sizeBytes: 1 },
    });
  });

  it("transcribes a clip, and the answer names the samples it was given", async () => {
    const { client } = await bootTestApp();
    const response = await client.voice.transcribe.$post({ json: { pcm: silence(800) } });
    expect(response.status).toBe(200);
    expect(voiceTranscribeResponseSchema.parse(await response.json())).toEqual({
      text: "scripted dictation of 800 samples",
    });
  });

  it("refuses audio that is not whole 16-bit samples", async () => {
    const { client } = await bootTestApp();
    const response = await client.voice.transcribe.$post({
      json: { pcm: Buffer.from([1, 2, 3]).toString("base64") },
    });
    expect(response.status).toBe(400);
  });

  it("refuses an empty clip rather than transcribing nothing", async () => {
    const { client } = await bootTestApp();
    const response = await client.voice.transcribe.$post({ json: { pcm: "" } });
    expect(response.status).toBe(400);
  });

  it("refuses a clip past the contract's ceiling before it reaches a runtime", async () => {
    const { client } = await bootTestApp();
    const response = await client.voice.transcribe.$post({
      json: {
        pcm: Buffer.alloc(VOICE_MAX_AUDIO_BYTES + 2).toString("base64"),
      },
    });
    expect(response.status).toBe(400);
  });

  it("takes install and remove as a switch, idempotently", async () => {
    const { client } = await bootTestApp();
    expect((await client.voice.model.install.$post()).status).toBe(200);
    const removed = await client.voice.model.remove.$post();
    expect(removed.status).toBe(200);
    expect((await client.voice.model.remove.$post()).status).toBe(200);
  });
});
