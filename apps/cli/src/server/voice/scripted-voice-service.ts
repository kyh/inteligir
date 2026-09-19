// a second implementation of the voice contract, not a pretend flag on the real one: a flag puts
// the branch inside the code the scenario tests.

import type { VoiceModel, VoiceStatusResponse } from "@repo/api/local/voice/voice-schema";
import { ScriptedStreamSession } from "./scripted-stream-session";
import type { VoiceService } from "./voice-service";

// the wire shape directly: there is no archive to pin, so a catalog spec would be fabricated.
const SCRIPTED_VOICE_MODEL: VoiceModel = {
  id: "scripted",
  label: "Scripted (test runtime)",
  sizeBytes: 1,
};

const status = (): Promise<VoiceStatusResponse> =>
  Promise.resolve({
    model: SCRIPTED_VOICE_MODEL,
    state: "ready",
  });

export const createScriptedVoiceService = (): VoiceService => ({
  createStreamSession: (handlers) => new ScriptedStreamSession(handlers),
  dispose: async () => {
    // nothing to stop
  },
  install: status,
  remove: status,
  status,
});
