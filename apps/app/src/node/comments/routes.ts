// The comments routes, registered against the contract rows. The editor is
// the caller and owns the body markers; these routes own the sidecar (the
// division the moss-comments skill states), so every answer is the fresh
// folded listing and `remove` also names the ids whose markers the editor
// must strip.

import { commentRoutes } from "@repo/server-contract/comments";
import { API_ERROR_STATUS, type ApiErrorResponse } from "@repo/server-contract/errors";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";

import { VaultServiceError } from "../vault/vault-service";
import { CommentRefusedError, SidecarInvalidError, type CommentsService } from "./comments-service";

type Refusal = { body: ApiErrorResponse; status: 400 | 404 | 409 } | null;

function classify(error: unknown): Refusal {
  if (error instanceof SidecarInvalidError) {
    return {
      body: { error: "conflict", message: error.message },
      status: API_ERROR_STATUS.conflict,
    };
  }
  if (error instanceof CommentRefusedError) {
    return {
      body: { error: "invalid_request", message: error.message },
      status: API_ERROR_STATUS.invalid_request,
    };
  }
  if (error instanceof VaultServiceError && error.code === "not_found") {
    return { body: { error: "not_found", message: error.message }, status: 404 };
  }
  if (error instanceof VaultServiceError && error.code === "invalid_path") {
    return { body: { error: "invalid_path", message: error.message }, status: 400 };
  }
  return null;
}

export function registerCommentsRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get" | "post">,
  comments: CommentsService,
): void {
  const { get, post } = registrars;

  // A list against a missing note still answers its sidecar (a thread can
  // outlive its note through an external delete): the service folds with
  // unknown markers rather than refusing.
  get(commentRoutes.list, async (c, query) => {
    try {
      return c.json(await comments.list(query.path));
    } catch (error) {
      const refusal = classify(error);
      if (refusal !== null) return c.json(refusal.body, refusal.status);
      throw error;
    }
  });

  post(commentRoutes.add, async (c, body) => {
    try {
      return c.json(await comments.add(body));
    } catch (error) {
      const refusal = classify(error);
      if (refusal !== null) return c.json(refusal.body, refusal.status);
      throw error;
    }
  });

  post(commentRoutes.reply, async (c, body) => {
    try {
      return c.json(await comments.reply(body));
    } catch (error) {
      const refusal = classify(error);
      if (refusal !== null) return c.json(refusal.body, refusal.status);
      throw error;
    }
  });

  post(commentRoutes.resolve, async (c, body) => {
    try {
      return c.json(await comments.resolve(body));
    } catch (error) {
      const refusal = classify(error);
      if (refusal !== null) return c.json(refusal.body, refusal.status);
      throw error;
    }
  });

  post(commentRoutes.remove, async (c, body) => {
    try {
      return c.json(await comments.remove(body));
    } catch (error) {
      const refusal = classify(error);
      if (refusal !== null) return c.json(refusal.body, refusal.status);
      throw error;
    }
  });
}
