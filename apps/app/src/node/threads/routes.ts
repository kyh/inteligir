// Registers the /threads/* contract rows against a ThreadService. Handlers
// only translate typed service outcomes into the contract's response union —
// nothing here reads the db or knows a send mode.

import { API_ERROR_STATUS, type ApiErrorResponse } from "@repo/server-contract/errors";
import { threadRoutes } from "@repo/server-contract/threads";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import type { ThreadService } from "./service";

const NOT_FOUND: ApiErrorResponse = { error: "not_found", message: "Thread not found" };

export function registerThreadRoutes(
  routes: Pick<TypedRoutesRegistrars, "get" | "post">,
  service: ThreadService,
): void {
  routes.get(threadRoutes.list, (c) => c.json({ threads: service.list() }));

  routes.get(threadRoutes.get, (c, query) => {
    const detail = service.get(query.threadId);
    if (detail === null) {
      return c.json(NOT_FOUND, API_ERROR_STATUS.not_found);
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
      return c.json(NOT_FOUND, API_ERROR_STATUS.not_found);
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
        return c.json(NOT_FOUND, API_ERROR_STATUS.not_found);
      case "conflict":
        return c.json(
          { error: outcome.error, message: outcome.message },
          API_ERROR_STATUS[outcome.error],
        );
      case "provider-unavailable":
        return c.json(
          { error: "provider_unavailable", message: outcome.message },
          API_ERROR_STATUS.provider_unavailable,
        );
      case "dispatch-failed":
        return c.json(
          { error: "dispatch_failed", message: "The agent provider failed to accept the turn" },
          API_ERROR_STATUS.dispatch_failed,
        );
    }
  });

  routes.get(threadRoutes.timeline, (c, query) => {
    const response = service.timeline(query);
    if (response === null) {
      return c.json(NOT_FOUND, API_ERROR_STATUS.not_found);
    }
    return c.json(response);
  });

  routes.get(threadRoutes.listInteractions, (c, query) =>
    c.json({ interactions: service.listInteractions(query.threadId) }),
  );

  routes.post(threadRoutes.answerInteraction, (c, body) => {
    const outcome = service.answerInteraction(body);
    switch (outcome.kind) {
      case "resolved":
        return c.json({ interaction: outcome.interaction });
      case "not-found":
        return c.json(
          { error: "not_found", message: "Interaction not found" },
          API_ERROR_STATUS.not_found,
        );
      case "already-resolved":
        return c.json(
          { error: "already_resolved", message: "The interaction was already answered" },
          API_ERROR_STATUS.already_resolved,
        );
      case "invalid-resolution":
        return c.json(
          { error: "invalid_resolution", message: outcome.message },
          API_ERROR_STATUS.invalid_resolution,
        );
    }
  });
}
