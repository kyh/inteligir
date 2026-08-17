// Registers the /threads/* contract rows against a ThreadService. Handlers
// only translate typed service outcomes into the contract's response union —
// nothing here reads the db or knows a send mode.

import type { ApiErrorResponse } from "@repo/server-contract/routes";
import { threadRoutes } from "@repo/server-contract/threads";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import type { ThreadService } from "./service";

const NOT_FOUND: ApiErrorResponse = { error: "not_found", message: "Thread not found" };

export interface RegisterThreadRoutesArgs {
  routes: Pick<TypedRoutesRegistrars, "get" | "post">;
  service: ThreadService;
}

export function registerThreadRoutes(args: RegisterThreadRoutesArgs): void {
  const { routes, service } = args;

  routes.get(threadRoutes.list, (c) => c.json({ threads: service.list() }));

  routes.get(threadRoutes.get, (c, query) => {
    const detail = service.get(query.threadId);
    if (detail === null) {
      return c.json(NOT_FOUND, 404);
    }
    return c.json(detail);
  });

  routes.get(threadRoutes.byDoc, (c, query) =>
    c.json({ threads: service.listByDoc(query.docPath) }),
  );

  routes.post(threadRoutes.create, (c, body) => c.json({ thread: service.create(body) }, 201));

  routes.post(threadRoutes.archive, (c, body) => {
    const thread = service.archive(body.threadId);
    if (thread === null) {
      return c.json(NOT_FOUND, 404);
    }
    return c.json({ thread });
  });

  routes.post(threadRoutes.send, (c, body) => {
    const outcome = service.send(body);
    switch (outcome.kind) {
      case "started":
      case "steered":
        return c.json({ kind: outcome.kind, turnId: outcome.turnId });
      case "queued":
        return c.json({ kind: "queued", queuedMessageId: outcome.queuedMessageId });
      case "not-found":
        return c.json(NOT_FOUND, 404);
      case "conflict":
        return c.json({ error: outcome.error, message: outcome.message }, 409);
      case "provider-unavailable":
        return c.json({ error: "provider_unavailable", message: outcome.message }, 503);
      case "dispatch-failed":
        return c.json(
          { error: "dispatch_failed", message: "The agent provider failed to accept the turn" },
          503,
        );
    }
  });

  routes.get(threadRoutes.timeline, (c, query) => {
    const response = service.timeline(query);
    if (response === null) {
      return c.json(NOT_FOUND, 404);
    }
    return c.json(response);
  });

  routes.post(threadRoutes.answerInteraction, (c, body) => {
    const outcome = service.answerInteraction(body);
    switch (outcome.kind) {
      case "resolved":
        return c.json({ interaction: outcome.interaction });
      case "not-found":
        return c.json({ error: "not_found", message: "Interaction not found" }, 404);
      case "already-resolved":
        return c.json(
          { error: "already_resolved", message: "The interaction was already answered" },
          409,
        );
      case "invalid-resolution":
        return c.json({ error: "invalid_resolution", message: outcome.message }, 400);
    }
  });
}
