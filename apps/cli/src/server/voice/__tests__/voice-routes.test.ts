import { isDefinedError, ORPCError, safe } from "@orpc/client";
import {
  VOICE_BYTES_PER_SAMPLE,
  VOICE_MAX_AUDIO_BYTES,
  voiceStatusResponseSchema,
  voiceTranscribeResponseSchema,
} from "@repo/api/local/voice/voice-schema";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";

function silence(sampleCount: number): string {
  return Buffer.alloc(sampleCount * VOICE_BYTES_PER_SAMPLE).toString("base64");
}

const scriptedReady = {
  state: "ready",
  model: { id: "scripted", label: "Scripted (test runtime)", sizeBytes: 1 },
};

describe("the voice routes", () => {
  it("answers a status the contract's own schema accepts", async () => {
    const { client } = await bootTestApp();
    expect(voiceStatusResponseSchema.parse(await client.voice.status())).toEqual(scriptedReady);
  });

  it("transcribes a clip, and the answer names the samples it was given", async () => {
    const { client } = await bootTestApp();
    const answer = await client.voice.transcribe({ pcm: silence(800) });
    expect(voiceTranscribeResponseSchema.parse(answer)).toEqual({
      text: "scripted dictation of 800 samples",
    });
  });

  it("refuses audio that is not whole 16-bit samples", async () => {
    const { client } = await bootTestApp();
    const [error] = await safe(
      client.voice.transcribe({ pcm: Buffer.from([1, 2, 3]).toString("base64") }),
    );
    expect(isDefinedError(error) && error.code).toBe("BAD_REQUEST");
  });

  it("refuses an empty clip rather than transcribing nothing", async () => {
    const { client } = await bootTestApp();
    const [error] = await safe(client.voice.transcribe({ pcm: "" }));
    expect(isDefinedError(error) && error.code).toBe("BAD_REQUEST");
  });

  it("refuses a clip past the contract's ceiling before it reaches a runtime", async () => {
    const { client } = await bootTestApp();
    const [error] = await safe(
      client.voice.transcribe({
        pcm: Buffer.alloc(VOICE_MAX_AUDIO_BYTES + 2).toString("base64"),
      }),
    );
    // raised by input validation, so it is not a declared error and isDefinedError is false.
    expect(error instanceof ORPCError && error.code).toBe("BAD_REQUEST");
  });

  it("takes install and remove as a switch, idempotently", async () => {
    const { client } = await bootTestApp();
    expect(voiceStatusResponseSchema.parse(await client.voice.install())).toEqual(scriptedReady);
    expect(voiceStatusResponseSchema.parse(await client.voice.remove())).toEqual(scriptedReady);
    expect(voiceStatusResponseSchema.parse(await client.voice.remove())).toEqual(scriptedReady);
  });
});
