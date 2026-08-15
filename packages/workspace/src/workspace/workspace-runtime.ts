// ---------------------------------------------------------------------------
// Ending an account's session inside one document.
//
// Sign-out used to be `window.location.assign` — correct only because it was a
// sledgehammer. The workspace's state is a constellation of module-scope stores
// and latches, and several of them are WRITE-ONCE: `initStarted` in the two AI
// stores is set on first init and never cleared, `initPromise` in ui-state is
// memoized forever, `chatGeneration` counts a surface that a reload discards.
// A router navigate would have left every one of them holding the previous
// account's answers, so the reload was load-bearing rather than lazy.
//
// This is the one place that ends a session, so the list below is the whole
// answer to "what belongs to the account rather than to the app". A store that
// grows account-scoped state adds a `reset()` and a line here; nothing else
// needs to know.
//
// ORDER MATTERS. The open note is flushed FIRST, while its bridge is still
// live — after the transport is disposed there is nowhere for the bytes to go,
// and losing an unsaved keystroke on sign-out is the one failure this path
// cannot have. Everything after it is cancellation, which cannot fail.
//
// NOT DONE HERE, and deliberately: the stores are still module singletons, so
// this ends a session rather than isolating one. Two accounts in one document
// needs them instanced (`createStore()` per runtime, `useStore(runtime.x, …)`
// at every call site) — a much larger change whose only new capability is
// account SWITCHING. Ending a session correctly is the part that was broken.
// ---------------------------------------------------------------------------

import { useAiProviderStore } from "@repo/editor/stores/ai-provider-store";
import { useAiSettingsStore } from "@repo/editor/stores/ai-settings-store";
import { useDelegationStore } from "@repo/editor/stores/delegation-store";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { resetOpenNote } from "@repo/editor/note/open-note-store";
import { consumeSearchRequest } from "@repo/editor/search-request";

import { useAgentStore } from "../stores/agent-store";
import { useUiStateStore } from "../stores/ui-state-store";
import { useViewStore } from "../stores/view-store";
import { stopReadAloud } from "../voice/read-aloud";
import { useVoiceStore } from "../stores/voice-store";

/**
 * Tear down everything scoped to the account whose session just ended.
 *
 * Resolves once the open note's bytes are safe and every account-scoped store
 * is back at its initial state, so the next sign-in in the same document starts
 * from the same place a fresh load would.
 */
export async function endWorkspaceSession(): Promise<void> {
  // While the bridge is still live. A refusal here is not a reason to keep the
  // session open — the user asked to leave — but it must be attempted.
  try {
    await flushOpenNote();
  } catch {
    // The note could not be saved. Nothing further can be done about it from
    // here, and blocking sign-out on it would strand the user in an account
    // they asked to leave.
  }

  // Anything holding a microphone or a speaker, before the transport goes.
  stopReadAloud();
  useVoiceStore.getState().reset();

  // FIRST among the resets, and after the flush above: it holds the previous
  // account's note bytes, which every editor surface renders directly.
  resetOpenNote();
  useAgentStore.getState().reset();
  useUiStateStore.getState().reset();
  useViewStore.getState().reset();
  useAiProviderStore.getState().reset();
  useAiSettingsStore.getState().reset();
  useDelegationStore.getState().reset();
  consumeSearchRequest();
}
