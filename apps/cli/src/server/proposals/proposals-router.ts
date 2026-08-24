// The proposals handlers against a ProposalService. Handlers only translate
// typed outcomes into the contract's answer; every CAS decision happens below
// them.
//
// ONE outcome→refusal table, because accept and reject answer the same five
// outcomes and two copies of that mapping is how one verb ends up calling a
// stale revision a conflict and the other a bad request.

import type {
  AcceptProposalRequest,
  ResolveProposalResponse,
} from "@repo/api/local/proposals/proposals-schema";
import { base } from "../orpc";
import type { ProposalOutcome, ResolveProposalArgs } from "./proposal-service";

const NOT_FOUND_MESSAGE = "Suggestion not found";

/**
 * The refusal constructors accept and reject share — every class here is one
 * BOTH contract rows declare. Named structurally so the mapping below can be
 * one function rather than a switch per handler.
 */
interface ProposalRefusals {
  /** A hunk index outside the derived list — the server's judgement about a
   *  value that parsed, which is what BAD_REQUEST names. */
  BAD_REQUEST: (options: { message: string }) => Error;
  NOT_FOUND: (options: { message: string }) => Error;
  CONFLICT: (options: { message: string }) => Error;
  /** `current` stays absent: nothing here read the file back, so there are no
   *  bytes to merge against — the caller re-runs the task instead. */
  CAS_MISMATCH: (options: { message: string; data: { current?: undefined } }) => Error;
}

/** The proposal a verb settled on, or the class its outcome refuses with. */
function proposalAnswer(
  outcome: ProposalOutcome,
  errors: ProposalRefusals,
): ResolveProposalResponse {
  switch (outcome.kind) {
    case "resolved":
      return { proposal: outcome.proposal };
    case "not-found":
      throw errors.NOT_FOUND({ message: NOT_FOUND_MESSAGE });
    case "no-such-hunk":
      throw errors.BAD_REQUEST({ message: outcome.message });
    case "revision-conflict":
      throw errors.CONFLICT({ message: outcome.message });
    case "disk-changed":
      throw errors.CAS_MISMATCH({ message: outcome.message, data: {} });
  }
}

/** Accept and reject carry the SAME body (see the header) — one reader serves
 *  both. `hunkIndex` stays absent when unsent. */
function resolveArgs(body: AcceptProposalRequest): ResolveProposalArgs {
  const args: ResolveProposalArgs = {
    proposalId: body.proposalId,
    expectedRevision: body.expectedRevision,
  };
  if (body.hunkIndex !== undefined) args.hunkIndex = body.hunkIndex;
  return args;
}

const list = base.proposals.list.handler(async ({ context, input }) => ({
  proposals: await context.proposals.list(input),
}));

const get = base.proposals.get.handler(async ({ context, input, errors }) => {
  const proposal = await context.proposals.get(input.proposalId);
  if (proposal === null) {
    throw errors.NOT_FOUND({ message: NOT_FOUND_MESSAGE });
  }
  return { proposal };
});

const accept = base.proposals.accept.handler(async ({ context, input, errors }) =>
  proposalAnswer(await context.proposals.accept(resolveArgs(input)), errors),
);

const reject = base.proposals.reject.handler(async ({ context, input, errors }) =>
  proposalAnswer(await context.proposals.reject(resolveArgs(input)), errors),
);

export const proposalsRouter = {
  list,
  get,
  accept,
  reject,
};
