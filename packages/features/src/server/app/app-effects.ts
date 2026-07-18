// ---------------------------------------------------------------------------
// Side effect execution — maps EffectTags to async operations.
// Returns a completion MachineEvent to feed back into the reducer.
// ---------------------------------------------------------------------------

import { toErrorMessage } from "@repo/features/ipc";
import type { SetupProgress } from "@repo/features/ipc-registry";
import type { MachineEvent } from "@repo/features/app-state";
import type { EffectTag } from "./app-reducer";

export type EffectDeps = {
  seedResources: (onProgress: (p: SetupProgress) => void) => Promise<void>;
  downloadVoiceModel: () => Promise<void>;
  startAgent: () => Promise<void>;
  stopAgent: () => Promise<void>;
  /** The full ~/.inteligir wipe (RESET only). Suspends vault writes. */
  teardownResources: () => void;
  /** Lift the vault-write suspension teardownResources put in place, before
   * the RESET effect re-seeds the workspace. */
  resumeVaultWrites: () => void;
  newSession: () => Promise<void>;
  reportSetupProgress: (progress: SetupProgress) => void;
};

/** Seed + start — the shared body of SETUP and the re-setup half of RESET.
 * Must not throw past the caller's try (both wrap it). */
async function runSetup(deps: EffectDeps): Promise<void> {
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
}

export async function runEffect(tag: EffectTag, deps: EffectDeps): Promise<MachineEvent> {
  switch (tag) {
    case "SETUP": {
      try {
        await runSetup(deps);
        return { type: "SETUP_OK" };
      } catch (err) {
        return { type: "SETUP_FAIL", message: toErrorMessage(err) };
      }
    }

    case "RESET": {
      // Full teardown + re-setup in ONE effect: stop the agent, wipe
      // ~/.inteligir (teardownResources suspends vault writes so a late
      // autosave can't resurrect app state mid-rm), lift the suspension, then
      // rebuild the workspace like a fresh SETUP. Must always produce a
      // completion event — a throw here would otherwise wedge "setting_up".
      try {
        await deps.stopAgent();
        deps.teardownResources();
        deps.resumeVaultWrites();
        await runSetup(deps);
        return { type: "SETUP_OK" };
      } catch (err) {
        return { type: "SETUP_FAIL", message: toErrorMessage(err) };
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
