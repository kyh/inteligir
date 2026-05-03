// ---------------------------------------------------------------------------
// Side effect execution — maps EffectTags to async operations.
// Returns a completion MachineEvent to feed back into the reducer.
// ---------------------------------------------------------------------------

import { runSetup } from "@/main/lifecycle";
import { toErrorMessage } from "@/shared/ipc";
import type { MachineEvent } from "@/shared/app-state";
import { clearResolvedSessionFile } from "./session-history";
import type { EffectTag } from "./app-reducer";

export type EffectDeps = {
  login: () => Promise<void>;
  stopAgent: () => Promise<void>;
  teardownResources: () => void;
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
      const result = await runSetup();
      if (result.ok) return { type: "SETUP_OK" };
      return { type: "SETUP_FAIL", message: `${result.step}: ${result.message}` };
    }

    case "LOGOUT": {
      clearResolvedSessionFile();
      await deps.stopAgent();
      deps.teardownResources();
      return { type: "LOGOUT_OK" };
    }
  }
}
