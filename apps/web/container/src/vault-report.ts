// ---------------------------------------------------------------------------
// What the object's answer to a vault report MEANS.
//
// The container's `./vault` is a copy. A file the agent wrote there is not a
// note until the object has applied it, and the object applies nothing
// unconditionally: a reported removal is refused outright (deletion is the
// destructive tier, where a human answers first), a write with no restore point
// is refused, and a write can simply fail. Every one of those comes back in
// `rejected`.
//
// SO THE ANSWER HAS TO REACH THE MODEL. The agent used its own `write`/`edit`/
// `bash`, which succeeded — against the copy. Left unread, the reply makes the
// model believe it deleted a note that is still there and saved work that was
// never saved, and it will go on to build on both. There is nothing to retry
// here and nothing to repair; the only correct move is to say what did not
// happen, in the turn that can still act on it.
//
// It is a pure function over the reply so that the daemon's wiring — steer the
// running session, advance the held revision — is the only part that needs a
// process. That is also what lets the SCRIPTED container (the Worker's
// ./fake-sandbox) read the object's answer with this reader rather than a
// second one: the file names no transport and no node, so it loads on workerd.
// ---------------------------------------------------------------------------

import type { AgentReport, AgentReportReply, VaultOp } from "./protocol";

export type VaultReportDeps = {
  /** Post one report; `null` when it did not land. The image's reporter,
   * narrowed to the one call this makes — naming the whole thing would put a
   * node-typed module in the graph of every host that reads a reply. */
  readonly send: (report: AgentReport) => Promise<AgentReportReply | null>;
  /** The revision the container currently believes its `./vault` is at. */
  readonly heldRevision: () => number;
  /** Adopt the revision the object answered with. */
  readonly setRevision: (revision: number) => void;
  /** Say something to the model mid-turn. */
  readonly tellAgent: (text: string) => Promise<void>;
};

/**
 * The watcher's report callback: post one batch of ops and ACT ON THE ANSWER.
 *
 * Both halves of acting on it are here rather than at the call site, because
 * both are easy to leave out and neither fails loudly: a reply nobody reads
 * leaves the model believing every write landed, and a revision nobody adopts
 * has the object re-push the container's own bytes back at it on every wake.
 */
export function createVaultReport(
  deps: VaultReportDeps,
): (ops: readonly VaultOp[]) => Promise<void> {
  return async (ops) => {
    const held = deps.heldRevision();
    const reply = await deps.send({ kind: "vault", fromRevision: held, ops: [...ops] });
    const outcome = readVaultReply(held, ops, reply);
    deps.setRevision(outcome.revision);
    if (outcome.notice !== "") await deps.tellAgent(outcome.notice);
  };
}

export type VaultReportOutcome = {
  /** The revision the container may now claim to hold. The object answers with
   * its own current one only when nothing but these ops moved the vault, so
   * this is either an advance or the baseline unchanged — never a guess. */
  readonly revision: number;
  /** What the model has to be told, or `""` when every op landed. */
  readonly notice: string;
};

/**
 * Read the object's answer to one batch of vault ops.
 *
 * `held` is the revision the container reported the batch against, and is what
 * the outcome falls back to on every path that cannot prove an advance — a
 * dropped reply, an answer of the wrong kind, an answer this build cannot
 * parse. A container that is BEHIND re-materializes files it already has; one
 * that is AHEAD never gets sent a file it is missing.
 */
export function readVaultReply(
  held: number,
  ops: readonly VaultOp[],
  reply: AgentReportReply | null,
): VaultReportOutcome {
  if (reply === null) {
    return { revision: held, notice: unreached(ops) };
  }
  if (reply.kind !== "vault") {
    return { revision: held, notice: unreached(ops) };
  }
  if (reply.rejected.length === 0) return { revision: reply.revision, notice: "" };
  return {
    revision: reply.revision,
    notice: [
      "The vault of record refused some of what you just wrote to ./vault. Those files are " +
        "unchanged for the user, whatever ./vault now shows. Do not repeat the same write — " +
        "read the reason and act on it.",
      "",
      ...reply.rejected.map((reason) => `- ${reason}`),
    ].join("\n"),
  };
}

/** The reply never arrived, so nothing is known about any of the batch. Named
 * per path, because "some writes may not have landed" is not something a model
 * can act on and a list of paths is. */
function unreached(ops: readonly VaultOp[]): string {
  if (ops.length === 0) return "";
  return [
    "Your changes to these files under ./vault could not be reported to the vault of record, " +
      "so it is UNKNOWN whether the user has them. Do not assume either way, and say so " +
      "rather than building on them:",
    "",
    ...ops.map((op) => `- ${op.path}`),
  ].join("\n");
}
