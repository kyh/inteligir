import { voiceStatusResponseSchema } from "@repo/api/local/voice/voice-schema";
import { describe, expect, it } from "vitest";
import { bootTestApp } from "../../__tests__/boot-app";

const scriptedReady = {
  state: "ready",
  model: { id: "scripted", label: "Scripted (test runtime)", sizeBytes: 1 },
};

describe("the voice routes", () => {
  it("answers a status the contract's own schema accepts", async () => {
    const { client } = await bootTestApp();
    expect(voiceStatusResponseSchema.parse(await client.voice.status())).toEqual(scriptedReady);
  });

  it("takes install and remove as a switch, idempotently", async () => {
    const { client } = await bootTestApp();
    expect(voiceStatusResponseSchema.parse(await client.voice.install())).toEqual(scriptedReady);
    expect(voiceStatusResponseSchema.parse(await client.voice.remove())).toEqual(scriptedReady);
    expect(voiceStatusResponseSchema.parse(await client.voice.remove())).toEqual(scriptedReady);
  });
});
