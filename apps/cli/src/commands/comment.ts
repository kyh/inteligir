import { defineCommand } from "citty";

import type { CommentThreadWire } from "@repo/api/local/comments/comments-schema";
import { COMMENT_SOURCES, mintCommentId } from "@repo/notes/comments/sidecar-schema";
import type { CommentSource } from "@repo/notes/comments/sidecar-schema";
import { apiFor, isAgentShell } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, outputJson, writeLines } from "../output";

// citty's enum type infers from a mutable array, so the readonly tuple is spread.
const sourceArg = {
  source: {
    description: "Who is writing (default: agent inside an agent shell, else user)",
    options: [...COMMENT_SOURCES],
    type: "enum" as const,
  },
};

const sourceFor = (deps: CliDeps, override: CommentSource | undefined): CommentSource =>
  override ?? (isAgentShell(deps.env) ? "agent" : "user");

const describeThread = (thread: CommentThreadWire): string[] => {
  let status = "open (unanchored)";
  if (thread.resolved) {
    status = "resolved";
  } else if (thread.anchored) {
    status = "open";
  }
  const head = `${thread.rootId} [${status}] ${thread.root.source ?? "unknown"}: ${thread.root.text}`;
  const replies = thread.replies.map(
    (reply) => `  ↳ ${reply.id} ${reply.entry.source ?? "unknown"}: ${reply.entry.text}`,
  );
  return [head, ...replies];
};

export const commentCommand = (deps: CliDeps) =>
  defineCommand({
    meta: { description: "Anchored comments on a note", name: "comment" },
    subCommands: {
      add: defineCommand({
        args: {
          path: { description: "Vault-relative note path", required: true, type: "positional" },
          text: { description: "The comment text", required: true, type: "positional" },
          ...sourceArg,
          ...jsonArg,
        },
        meta: {
          description:
            "Start a comment thread in the note's store (unanchored until markers wrap a range)",
          name: "add",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const id = mintCommentId();
          const body = await api.comments.add({
            id,
            path: args.path,
            source: sourceFor(deps, args.source),
            text: args.text,
          });
          if (outputJson(args, { id, ...body })) {
            return;
          }
          writeLines([`Comment ${id} added to ${body.path}.`]);
        },
      }),

      list: defineCommand({
        args: {
          path: { description: "Vault-relative note path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "A note's comment threads", name: "list" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.comments.list({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          if (body.threads.length === 0) {
            writeLines([`No comments on ${body.path}.`]);
            return;
          }
          writeLines(body.threads.flatMap(describeThread));
        },
      }),

      remove: defineCommand({
        /* oxlint-disable sort-keys -- citty binds positionals in declaration order */
        args: {
          path: { description: "Vault-relative note path", required: true, type: "positional" },
          id: { description: "The thread's root id", required: true, type: "positional" },
          ...jsonArg,
        },
        /* oxlint-enable sort-keys */
        meta: {
          description: "Delete a comment thread's store entries (markers stay yours to strip)",
          name: "remove",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.comments.remove({ id: args.id, path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          writeLines([
            `Thread ${args.id} removed.`,
            ...(body.removedIds.length > 0
              ? [`Strip its markers from the note: %%i:${body.removedIds.join(",")}:start/end%%`]
              : []),
          ]);
        },
      }),

      reply: defineCommand({
        /* oxlint-disable sort-keys -- citty binds positionals in declaration order */
        args: {
          path: { description: "Vault-relative note path", required: true, type: "positional" },
          parent: { description: "Root or reply id", required: true, type: "positional" },
          text: { description: "The reply text", required: true, type: "positional" },
          ...sourceArg,
          ...jsonArg,
        },
        /* oxlint-enable sort-keys */
        meta: { description: "Reply inside a comment thread", name: "reply" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const id = mintCommentId();
          const body = await api.comments.reply({
            id,
            parentId: args.parent,
            path: args.path,
            source: sourceFor(deps, args.source),
            text: args.text,
          });
          if (outputJson(args, { id, ...body })) {
            return;
          }
          writeLines([`Reply ${id} added under ${args.parent}.`]);
        },
      }),

      resolve: defineCommand({
        /* oxlint-disable sort-keys -- citty binds positionals in declaration order */
        args: {
          path: { description: "Vault-relative note path", required: true, type: "positional" },
          id: { description: "The thread's root id", required: true, type: "positional" },
          reopen: { description: "Reopen instead of resolving", type: "boolean" },
          ...sourceArg,
          ...jsonArg,
        },
        /* oxlint-enable sort-keys */
        meta: { description: "Resolve (or reopen) a comment thread", name: "resolve" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const resolved = args.reopen !== true;
          const body = await api.comments.resolve({
            id: args.id,
            path: args.path,
            resolved,
            source: sourceFor(deps, args.source),
          });
          if (outputJson(args, body)) {
            return;
          }
          writeLines([`Thread ${args.id} ${resolved ? "resolved" : "reopened"}.`]);
        },
      }),
    },
  });
