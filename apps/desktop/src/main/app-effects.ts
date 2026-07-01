// ---------------------------------------------------------------------------
// Side effect execution — maps EffectTags to async operations.
// Returns a completion MachineEvent to feed back into the reducer.
// ---------------------------------------------------------------------------

import { toErrorMessage, type SetupProgress } from "@repo/core/ipc";
import type { MachineEvent } from "@repo/core/app-state";
import type { EffectTag } from "./app-reducer";

export type EffectDeps = {
  login: () => Promise<void>;
  seedResources: (onProgress: (p: SetupProgress) => void) => Promise<void>;
  downloadVoiceModel: () => Promise<void>;
  startAgent: () => Promise<void>;
  stopAgent: () => Promise<void>;
  teardownResources: () => void;
  newSession: () => Promise<void>;
  reportSetupProgress: (progress: SetupProgress) => void;
};

export async function runEffect(tag: EffectTag, deps: EffectDeps): Promise<MachineEvent> {
  switch (tag) {
    case "LOGIN": {
      try {
        await deps.login();
        return { type: "LOGIN_OK" };
      } catch (err) {
        return { type: "LOGIN_FAIL", message: toErrorMessage(err) };
      }
    }

    case "SETUP": {
      try {
        // Fire the speech-model download off the critical path. It's
        // best-effort (the mic toggle retries) and the renderer subscribes to
        // onVoiceModelState directly, so awaiting it only delays the agent.
        void deps.downloadVoiceModel().catch((err: unknown) => {
          console.warn("[setup] voice model download failed (non-fatal):", err);
        });
        deps.reportSetupProgress({ step: "Preparing workspace", percent: null });
        await deps.seedResources(deps.reportSetupProgress);
        deps.reportSetupProgress({ step: "Starting agent", percent: null });
        await deps.startAgent();
        deps.reportSetupProgress({ step: "done", percent: 100 });
        return { type: "SETUP_OK" };
      } catch (err) {
        return { type: "SETUP_FAIL", message: toErrorMessage(err) };
      }
    }

    case "LOGOUT": {
      // Like LOGIN/SETUP, this must always produce a completion event — a
      // throw here would otherwise wedge the machine in "logging_out".
      try {
        await deps.stopAgent();
        deps.teardownResources();
        return { type: "LOGOUT_OK" };
      } catch (err) {
        return { type: "LOGOUT_FAIL", message: toErrorMessage(err) };
      }
    }

    case "NEW_SESSION": {
      // newSession = stop + start: a throw leaves no agent behind, so it must
      // surface as a failure event instead of leaving "ready" with a null
      // agent (every subsequent send would silently hit "Agent unavailable").
      try {
        await deps.newSession();
        return { type: "NEW_SESSION_OK" };
      } catch (err) {
        return { type: "NEW_SESSION_FAIL", message: toErrorMessage(err) };
      }
    }
  }
}
