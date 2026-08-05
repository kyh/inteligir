// ---------------------------------------------------------------------------
// The agent's MUTATING capabilities — the write-checkpointed, delegate and
// destructive-confirmed tiers of @repo/bridge/agent-grants. Sibling of
// agent-knowledge-port.ts: that file projects what the model may SEE, this one
// decides what it may DO.
//
// Three rules hold for every method here, and none of them holds in the window
// handler the capability is named after:
//
//  (1) PRIVACY, live-disk. The renderer's handlers are privacy-blind on
//      purpose — the user acting on their own vault must be able to act on
//      every note. An AI action on a note marked `private: true` is an AI
//      action on a note that is supposed to be invisible to AI, so every
//      method probes the target against disk (not the index, which lags a
//      just-saved flag) and refuses. Fail-closed: unreadable frontmatter
//      counts as private.
//  (2) CAPTURE FIRST, fail-closed. The one write here runs through
//      RestoreManager before it touches the file; a capture failure throws out
//      of the capture call and the write never happens — the same rule the
//      chat tool gate enforces for pi's own edit/write
//      (agent/privacy/extension.ts) and delegation enforces for its pre-run
//      snapshot. An AI edit with no undo point must never happen.
//  (3) REFUSALS ARE VALUES. Nothing here throws at the model. A private note,
//      a stale line, a declined proposal and a missing file all come back as
//      one sentence the tool relays verbatim.
//
// The destructive pair raises its own confirmation INSIDE the port rather than
// leaving it to the calling tool — same hook shape as the HTML-app broker's
// `confirmRemove`, moved one level down so no tool can forget to ask. It is a
// prompt for a human, not a gate (CLAUDE.md § Decisions).
// ---------------------------------------------------------------------------

import { toggleTaskAtOrdinal } from "@repo/notes/knowledge/guarded-line-edit";

import type {
  AgentActionOk,
  AgentActionPort,
  AgentDeleteResult,
  AgentDelegateResult,
  AgentToggleTaskResult,
  PrivacyProbe,
} from "@repo/agent/extension";
import type { CreateDelegationParams, CreateDelegationResult } from "@repo/bridge/delegation";
import type { RestoreSnapshotResult } from "@repo/bridge/delegation";
import type { ConfirmationProposal } from "../agent-confirm/confirmation-broker";

/** The vault access the actions need. `VaultManager` satisfies it
 * structurally, so the port stays constructible over an in-memory fake. */
export type ActionVault = {
  readText(rel: string): string;
  writeText(rel: string, content: string): void;
  trash(rel: string): Promise<boolean>;
};

/** The delegation surface, narrowed to the three capabilities granted. */
export type ActionDelegations = {
  createDelegation(params: CreateDelegationParams): CreateDelegationResult;
  cancelDelegation(id: string): { ok: boolean };
  restoreSnapshot(id: string): Promise<RestoreSnapshotResult>;
};

/** The AI-edit undo surface, narrowed to the one capability granted. */
export type ActionRestores = {
  /** Undo the newest CHAT capture for one note. */
  restoreLatestChatEdit(path: string): Promise<{ ok: true } | { ok: false; error: string }>;
};

/** One sentence per refusal, in the wording family the file-tool gate uses:
 * path only, never content. */
function privacyRefusal(path: string, probe: PrivacyProbe, verb: string): string | null {
  if (probe === "public") return null;
  if (probe === "private") {
    return (
      `./vault/${path} is marked private (frontmatter \`private: true\`), so AI tools cannot ` +
      `${verb} it. Tell the user the note is private.`
    );
  }
  if (probe === "indeterminate") {
    return (
      `./vault/${path} has unreadable frontmatter and is treated as private (fail-closed), so ` +
      `it cannot be ${verb === "delete" ? "deleted" : `${verb}d`}. Tell the user the note ` +
      `could not be read.`
    );
  }
  return `./vault/${path} does not exist.`;
}

/** Renderer-facing failure text per guarded-toggle refusal, rewritten for a
 * model: each one says what to do next, because "the note changed" without
 * "re-read it" invites a retry with the same stale line. */
function toggleRefusal(reason: "line-missing" | "line-changed" | "not-a-checkbox"): string {
  switch (reason) {
    case "line-missing":
      return "That task is no longer in the file. Call list_tasks again for the current lines.";
    case "line-changed":
      return (
        "The note changed since that task list was built, so the line no longer matches " +
        "byte for byte. Call list_tasks again and retry with the line it returns."
      );
    case "not-a-checkbox":
      return "That line is not a checkbox anymore. Call list_tasks again.";
  }
}

export function buildAgentActionPort(deps: {
  /** LIVE disk probe — the SAME one the read ports take. */
  probe: (rel: string) => PrivacyProbe;
  vault: () => ActionVault;
  delegations: () => ActionDelegations;
  restores: () => ActionRestores;
  /** Pre-write checkpoint — the SAME chat-origin capture pi's own edits take,
   * so the toggle joins the post-turn undo toast instead of inventing a
   * second undo surface. MUST throw when capture fails: the write is skipped
   * and the model is told, rather than editing with no undo point. */
  capture: (path: string) => void;
  /** Ask the human. Resolves false on decline, timeout or teardown. */
  confirm: (proposal: ConfirmationProposal) => Promise<boolean>;
  /** Kick an index refresh after a refused toggle — a refusal means the
   * projection the model acted on was stale, so the index self-heals. */
  onStaleProjection: () => void;
}): AgentActionPort {
  return {
    toggleTask: (path, ordinal, expectedRaw): AgentToggleTaskResult => {
      const refusal = privacyRefusal(path, deps.probe(path), "edit");
      if (refusal !== null) return { ok: false, reason: refusal };
      const vault = deps.vault();
      let source: string;
      try {
        source = vault.readText(path);
      } catch {
        deps.onStaleProjection();
        return { ok: false, reason: `Couldn't read ./vault/${path}.` };
      }
      // The guard runs BEFORE the capture: a refused toggle writes nothing, so
      // capturing for it would fill the undo store with snapshots of edits
      // that never happened.
      const result = toggleTaskAtOrdinal(source, ordinal, expectedRaw);
      if (!result.ok) {
        deps.onStaleProjection();
        return { ok: false, reason: toggleRefusal(result.reason) };
      }
      try {
        deps.capture(path);
      } catch {
        return {
          ok: false,
          reason:
            `Couldn't save an undo point for ./vault/${path}, so the checkbox was NOT ` +
            `changed. Tell the user.`,
        };
      }
      vault.writeText(path, result.content);
      return { ok: true, checked: result.checked };
    },

    // Privacy is the delegation manager's own refusal here (the whole file
    // rides the background prompt, so it checks the source note itself) —
    // duplicating it would put two answers in the codebase for one question.
    delegateTask: (path, ordinal): AgentDelegateResult => {
      const result = deps.delegations().createDelegation({ sourceFile: path, ordinal });
      if (!result.ok) return { ok: false, reason: result.error };
      return { ok: true, id: result.delegation.id, lineText: result.delegation.lineText };
    },

    cancelDelegation: (id): AgentActionOk => {
      const result = deps.delegations().cancelDelegation(id);
      return result.ok
        ? { ok: true }
        : { ok: false, reason: "No background task with that id is queued or running." };
    },

    restoreDelegation: async (id): Promise<AgentActionOk> => {
      const result = await deps.delegations().restoreSnapshot(id);
      return result.ok ? { ok: true } : { ok: false, reason: result.error };
    },

    deleteNote: async (path): Promise<AgentDeleteResult> => {
      // Probed before the human is asked: a private note must not even produce
      // a dialog naming it.
      const refusal = privacyRefusal(path, deps.probe(path), "delete");
      if (refusal !== null) return { ok: false, reason: refusal };
      const confirmed = await deps.confirm({
        title: `Delete ${path}?`,
        detail: "The AI assistant proposed this. Moves the file to your system trash.",
        confirmLabel: "Delete",
      });
      if (!confirmed) {
        return {
          ok: false,
          reason: "The user declined the deletion. Leave the file alone and do not ask again.",
        };
      }
      const trashed = await deps.vault().trash(path);
      return { ok: true, trashed };
    },

    undoMyEdit: async (path): Promise<AgentActionOk> => {
      const refusal = privacyRefusal(path, deps.probe(path), "edit");
      if (refusal !== null) return { ok: false, reason: refusal };
      const confirmed = await deps.confirm({
        title: `Undo the assistant's last edit to ${path}?`,
        detail:
          "The AI assistant proposed this. Restores the note to how it was before that edit — " +
          "anything written to it since is lost.",
        confirmLabel: "Undo edit",
      });
      if (!confirmed) {
        return { ok: false, reason: "The user declined the undo. Leave the note as it is." };
      }
      const result = await deps.restores().restoreLatestChatEdit(path);
      return result.ok ? { ok: true } : { ok: false, reason: result.error };
    },
  };
}
