// ---------------------------------------------------------------------------
// Side effect execution — maps EffectTags to async operations.
// Returns a completion MachineEvent to feed back into the reducer.
// ---------------------------------------------------------------------------

import { toErrorMessage } from "@/shared/ipc";
import type { MachineEvent } from "@/shared/app-state";
import { clearResolvedSessionFile } from "./session-history";
import type { EffectTag } from "./app-reducer";

export type EffectDeps = {
  login: () => Promise<void>;
  seedResources: () => void;
  ensureSidecar: () => Promise<unknown>;
  teardownResources: () => void;
  killSidecar: () => Promise<void>;
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
        deps.seedResources();
        await deps.ensureSidecar();
        return { type: "SETUP_OK" };
      } catch (err) {
        return { type: "SETUP_FAIL", message: toErrorMessage(err) };
      }
    }

    case "LOGOUT": {
      clearResolvedSessionFile();
      deps.teardownResources();
      return { type: "LOGOUT_OK" };
    }
  }
}
