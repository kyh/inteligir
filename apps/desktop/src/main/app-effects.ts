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
  installGws: () => Promise<void>;
  installAgentBrowser: () => Promise<void>;
  installPeekaboo: () => Promise<void>;
  startAgent: () => Promise<void>;
  stopAgent: () => Promise<void>;
  teardownResources: () => void;
  newSession: () => Promise<void>;
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
        await Promise.all([
          deps.installGws(),
          deps.installAgentBrowser(),
          deps.installPeekaboo(),
        ]);
        await deps.startAgent();
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
