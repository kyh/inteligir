// Lifting a review-mode turn's writes out of the working tree and into the
// proposal store (issue #560). This is the producer half; ./proposal-service
// is the reviewer half.
//
// Per reported path, three steps in this order:
//
//   read the base at the turn's revision → record → revert
//
// The order matters at the last step only: the row is written BEFORE the
// working tree goes back, so a crash between them leaves a proposal whose
// base does not yet match disk — which reads as STALE and offers a re-run.
// The other order would delete the agent's work with nothing recording it.
//
// A path the agent wrote and then wrote BACK to its base contributes nothing:
// there is no change to review, so no row and no revert.

import { captureProposal } from "@repo/db/proposals";
import type { DbConnection } from "@repo/db/connection";
import type { DbNotifier } from "@repo/domain/notifier";
import { contentHashHex } from "@repo/server-contract/vault";
import type { CaptureTurnProposals } from "../agent/agent-commits";
import type { GitEngine } from "../vault/git";
import { VaultServiceError, type VaultService } from "../vault/vault-service";

export interface TurnProposalCaptureDeps {
  db: DbConnection;
  notifier: DbNotifier;
  git: GitEngine;
  vault: VaultService;
  onDebug?: (message: string) => void;
}

/** The agent's bytes for a path right now, or null when it left none there. */
async function currentContent(vault: VaultService, path: string): Promise<string | null> {
  try {
    return (await vault.read(path)).content;
  } catch (error) {
    if (error instanceof VaultServiceError && error.code === "not_found") {
      return null;
    }
    throw error;
  }
}

export function createTurnProposalCapture(deps: TurnProposalCaptureDeps): CaptureTurnProposals {
  const debug = (message: string): void => deps.onDebug?.(message);

  return async ({ threadId, turnId, baseRev, paths }) => {
    for (const path of paths) {
      try {
        const base = await deps.git.readBlob(baseRev, path);
        const proposed = await currentContent(deps.vault, path);
        if (base === proposed) {
          continue;
        }
        if (base === null && proposed === null) {
          continue;
        }

        captureProposal(deps.db, deps.notifier, {
          threadId,
          turnId,
          docPath: path,
          baseRev,
          baseHash: base === null ? null : await contentHashHex(base),
          baseContent: base ?? "",
          proposedContent: proposed,
        });

        // The revert, guarded on what the capture just read: a save that
        // landed in between keeps its bytes, and the proposal it invalidated
        // reads stale instead of silently overwriting it.
        const reverted =
          base === null
            ? // The turn CREATED the file; the base is its absence.
              proposed === null
              ? { applied: true as const }
              : await deps.vault.removeIfUnchanged(path, proposed)
            : proposed === null
              ? // The turn DELETED it; put the base back, but only if nothing
                // else has since taken the name.
                await deps.vault.writeGuarded(path, base, { ifAbsent: true })
              : await deps.vault.writeIfUnchanged(path, proposed, base);
        if (!reverted.applied) {
          debug(
            `proposal capture left ${path} as the agent wrote it: the file moved under the revert`,
          );
        }
      } catch (error) {
        // One unreadable path must not cost the turn its other proposals.
        debug(
          `proposal capture failed for ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };
}
