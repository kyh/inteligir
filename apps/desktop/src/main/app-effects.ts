// ---------------------------------------------------------------------------
// Side effect execution — maps EffectTags to async operations.
// Returns a completion MachineEvent to feed back into the reducer.
// ---------------------------------------------------------------------------

import { toErrorMessage, type SetupProgress } from "@/shared/ipc";
import type { MachineEvent } from "@/shared/app-state";
import { clearResolvedSessionFile } from "./session-history";
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
        await deps.seedResources(deps.reportSetupProgress);
        // Voice model is best-effort — a failed download must not block ready.
        // The user can retry from the mic toggle in the chat voice pane.
        deps.reportSetupProgress({ step: "Downloading speech model", percent: null });
        await deps.downloadVoiceModel().catch((err: unknown) => {
          console.warn("[setup] voice model download failed (non-fatal):", err);
        });
        deps.reportSetupProgress({ step: "Starting agent", percent: null });
        await deps.startAgent();
        deps.reportSetupProgress({ step: "done", percent: 100 });
        return { type: "SETUP_OK" };
      } catch (err) {
        return { type: "SETUP_FAIL", message: toErrorMessage(err) };
      }
    }

    case "LOGOUT": {
      clearResolvedSessionFile();
      await deps.stopAgent();
      deps.teardownResources();
      return { type: "LOGOUT_OK" };
    }

    case "NEW_SESSION": {
      await deps.newSession();
      return { type: "NEW_SESSION_OK" };
    }
  }
}
