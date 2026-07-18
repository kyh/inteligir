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
  /** Re-assert owner-only perms (0700 dirs / 0600 note-content files) after a
   * (re)seed — mirrors the boot-time sweep. seedResources' mkdirs run at the
   * umask default (0755) and pi then writes auth.json + transcripts 0644, so
   * without this a RESET would leave note content world-readable until the
   * next restart (CLAUDE.md § Decisions: ~/.inteligir is owner-only). */
  rehardenAppDir: () => void;
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
  // Sweep perms AFTER seed + agent start, so the dirs seedResources just
  // created (0755) and the auth.json/session files pi just wrote (0644) all
  // land owner-only, and later transcripts sit under 0700 dirs — the same
  // guarantee the boot-time hardenAppDir gives. Best-effort by contract (it
  // never throws), so it can't fail setup.
  deps.rehardenAppDir();
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
        // teardownResources suspends vault writes, THEN rm -rf's ~/.inteligir
        // and re-asserts the host lock — either of which can throw (EBUSY on a
        // lingering executor/sqlite handle, EPERM). The suspension MUST be
        // lifted regardless, or a RETRY reaches "ready" with writes wedged and
        // every autosave throws "Vault is signed out" silently. The finally
        // guarantees the resume on both the success and throw paths.
        try {
          deps.teardownResources();
        } finally {
          deps.resumeVaultWrites();
        }
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
