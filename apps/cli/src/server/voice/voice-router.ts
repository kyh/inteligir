// the refusal switch is exhaustive, undeclared classes included (they rethrow): a third class
// is then a compile error at every route rather than a silent 500.

import { base } from "../orpc";
import { VoiceBusyError, VoiceUnavailableError } from "./voice-errors";

type WriteRefusal = { kind: "busy"; message: string } | { kind: "unavailable"; message: string };

const refusalFor = (cause: unknown): WriteRefusal | null => {
  if (cause instanceof VoiceBusyError) {
    return { kind: "busy", message: cause.message };
  }
  if (cause instanceof VoiceUnavailableError) {
    return { kind: "unavailable", message: cause.message };
  }
  return null;
};

const status = base.voice.status.handler(async ({ context }) => await context.voice.status());

const install = base.voice.install.handler(async ({ context, errors }) => {
  try {
    return await context.voice.install();
  } catch (error) {
    const refusal = refusalFor(error);
    switch (refusal?.kind) {
      case "busy": {
        throw errors.CONFLICT({ message: refusal.message });
      }
      case "unavailable": {
        throw errors.PROVIDER_UNAVAILABLE({ message: refusal.message });
      }
      case undefined: {
        throw error;
      }
      // no default
    }
  }
});

const remove = base.voice.remove.handler(async ({ context }) => await context.voice.remove());

export const voiceRouter = {
  install,
  remove,
  status,
};
