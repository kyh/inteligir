// The /proposals/* contract rows against a ProposalService. Handlers only
// translate typed outcomes into the response union; every CAS decision
// happens below them.
//
// ONE outcome→response table, because accept and reject answer the same five
// outcomes and two copies of that mapping is how one verb ends up calling a
// stale revision a 409 and the other a 400.

import type { ApiErrorResponse } from "@repo/server-contract/errors";
import {
  proposalRoutes,
  type AcceptProposalRequest,
  type ResolveProposalResponse,
} from "@repo/server-contract/proposals";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import type { ProposalOutcome, ProposalService, ResolveProposalArgs } from "./proposal-service";

const NOT_FOUND: ApiErrorResponse = { error: "not_found", message: "Suggestion not found" };

type ProposalAnswer =
  | { status: 200; body: ResolveProposalResponse }
  | { status: 400 | 404 | 409; body: ApiErrorResponse };

function proposalAnswer(outcome: ProposalOutcome): ProposalAnswer {
  switch (outcome.kind) {
    case "resolved":
      return { status: 200, body: { proposal: outcome.proposal } };
    case "not-found":
      return { status: 404, body: NOT_FOUND };
    case "no-such-hunk":
      return { status: 400, body: { error: "invalid_request", message: outcome.message } };
    case "revision-conflict":
      return { status: 409, body: { error: "conflict", message: outcome.message } };
    case "disk-changed":
      return { status: 409, body: { error: "cas_mismatch", message: outcome.message } };
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

export interface RegisterProposalRoutesArgs {
  routes: Pick<TypedRoutesRegistrars, "get" | "post">;
  service: ProposalService;
}

export function registerProposalRoutes(args: RegisterProposalRoutesArgs): void {
  const { routes, service } = args;

  routes.get(proposalRoutes.list, async (c, query) =>
    c.json({ proposals: await service.list(query ?? {}) }),
  );

  routes.get(proposalRoutes.get, async (c, query) => {
    const proposal = await service.get(query.proposalId);
    if (proposal === null) {
      return c.json(NOT_FOUND, 404);
    }
    return c.json({ proposal });
  });

  routes.post(proposalRoutes.accept, async (c, body) => {
    const answer = proposalAnswer(await service.accept(resolveArgs(body)));
    return answer.status === 200 ? c.json(answer.body) : c.json(answer.body, answer.status);
  });

  routes.post(proposalRoutes.reject, async (c, body) => {
    const answer = proposalAnswer(await service.reject(resolveArgs(body)));
    return answer.status === 200 ? c.json(answer.body) : c.json(answer.body, answer.status);
  });
}
