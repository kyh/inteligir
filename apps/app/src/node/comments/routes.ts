// The comments routes, registered against the contract rows. The editor is
// the caller and owns the body markers; these routes own the sidecar (the
// division the moss-comments skill states), so every answer is the fresh
// folded listing and `remove` also names the ids whose markers the editor
// must strip.

import { commentRoutes } from "@repo/server-contract/comments";
import { API_ERROR_STATUS, type ApiErrorResponse } from "@repo/server-contract/errors";
import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";

import { VaultServiceError } from "../vault/vault-service";
import { CommentRefusedError, SidecarInvalidError, type CommentsService } from "./comments-service";

type Refusal =
  | { kind: "invalid"; body: ApiErrorResponse }
  | { kind: "missing"; body: ApiErrorResponse }
  | { kind: "conflict"; body: ApiErrorResponse };

function classify(cause: unknown): Refusal | null {
  if (cause instanceof SidecarInvalidError) {
    return { kind: "conflict", body: { error: "conflict", message: cause.message } };
  }
  if (cause instanceof CommentRefusedError) {
    return { kind: "invalid", body: { error: "invalid_request", message: cause.message } };
  }
  if (cause instanceof VaultServiceError && cause.code === "not_found") {
    return { kind: "missing", body: { error: "not_found", message: cause.message } };
  }
  if (cause instanceof VaultPathError) {
    return { kind: "invalid", body: { error: "invalid_path", message: cause.message } };
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
  // unknown markers rather than refusing, so `missing` cannot reach here.
  get(commentRoutes.list, async (c, query) => {
    try {
      return c.json(await comments.list(query.path));
    } catch (error) {
      const refusal = classify(error);
      if (refusal === null || refusal.kind === "missing") throw error;
      switch (refusal.kind) {
        case "invalid":
          return c.json(refusal.body, API_ERROR_STATUS.invalid_request);
        case "conflict":
          return c.json(refusal.body, API_ERROR_STATUS.conflict);
      }
    }
  });

  post(commentRoutes.add, async (c, body) => {
    try {
      return c.json(await comments.add(body));
    } catch (error) {
      const refusal = classify(error);
      if (refusal === null) throw error;
      switch (refusal.kind) {
        case "invalid":
          return c.json(refusal.body, API_ERROR_STATUS.invalid_request);
        case "missing":
          return c.json(refusal.body, API_ERROR_STATUS.not_found);
        case "conflict":
          return c.json(refusal.body, API_ERROR_STATUS.conflict);
      }
    }
  });

  post(commentRoutes.reply, async (c, body) => {
    try {
      return c.json(await comments.reply(body));
    } catch (error) {
      const refusal = classify(error);
      if (refusal === null) throw error;
      switch (refusal.kind) {
        case "invalid":
          return c.json(refusal.body, API_ERROR_STATUS.invalid_request);
        case "missing":
          return c.json(refusal.body, API_ERROR_STATUS.not_found);
        case "conflict":
          return c.json(refusal.body, API_ERROR_STATUS.conflict);
      }
    }
  });

  post(commentRoutes.resolve, async (c, body) => {
    try {
      return c.json(await comments.resolve(body));
    } catch (error) {
      const refusal = classify(error);
      if (refusal === null) throw error;
      switch (refusal.kind) {
        case "invalid":
          return c.json(refusal.body, API_ERROR_STATUS.invalid_request);
        case "missing":
          return c.json(refusal.body, API_ERROR_STATUS.not_found);
        case "conflict":
          return c.json(refusal.body, API_ERROR_STATUS.conflict);
      }
    }
  });

  post(commentRoutes.remove, async (c, body) => {
    try {
      return c.json(await comments.remove(body));
    } catch (error) {
      const refusal = classify(error);
      if (refusal === null) throw error;
      switch (refusal.kind) {
        case "invalid":
          return c.json(refusal.body, API_ERROR_STATUS.invalid_request);
        case "missing":
          return c.json(refusal.body, API_ERROR_STATUS.not_found);
        case "conflict":
          return c.json(refusal.body, API_ERROR_STATUS.conflict);
      }
    }
  });
}
