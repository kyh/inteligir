import { defineCommand } from "citty";

import type { CommentThreadWire } from "@repo/api/local/comments/comments-schema";
import {
  COMMENT_SOURCES,
  mintCommentId,
  type CommentSource,
} from "@repo/notes/comments/sidecar-schema";
import { apiFor, isAgentShell, type CliDeps } from "../context";
import { jsonArg, outputJson, writeLines } from "../output";

// citty's enum type infers from a mutable array, so the readonly tuple is spread.
const sourceArg = {
  source: {
    type: "enum" as const,
    options: [...COMMENT_SOURCES],
    description: "Who is writing (default: agent inside an agent shell, else user)",
  },
};

function sourceFor(deps: CliDeps, override: CommentSource | undefined): CommentSource {
  return override ?? (isAgentShell(deps.env) ? "agent" : "user");
}

function describeThread(thread: CommentThreadWire): string[] {
  const status = thread.resolved ? "resolved" : thread.anchored ? "open" : "open (unanchored)";
  const head = `${thread.rootId} [${status}] ${thread.root.source ?? "unknown"}: ${thread.root.text}`;
  const replies = thread.replies.map(
    (reply) => `  ↳ ${reply.id} ${reply.entry.source ?? "unknown"}: ${reply.entry.text}`,
  );
  return [head, ...replies];
}

export function commentCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "comment", description: "Anchored comments on a note" },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "A note's comment threads" },
        args: {
          path: { type: "positional", required: true, description: "Vault-relative note path" },
          ...jsonArg,
        },
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

      add: defineCommand({
        meta: {
          name: "add",
          description:
            "Start a comment thread in the sidecar (unanchored until markers wrap a range)",
        },
        args: {
          path: { type: "positional", required: true, description: "Vault-relative note path" },
          text: { type: "positional", required: true, description: "The comment text" },
          ...sourceArg,
          ...jsonArg,
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

      reply: defineCommand({
        meta: { name: "reply", description: "Reply inside a comment thread" },
        args: {
          path: { type: "positional", required: true, description: "Vault-relative note path" },
          parent: { type: "positional", required: true, description: "Root or reply id" },
          text: { type: "positional", required: true, description: "The reply text" },
          ...sourceArg,
          ...jsonArg,
        },
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
        meta: { name: "resolve", description: "Resolve (or reopen) a comment thread" },
        args: {
          path: { type: "positional", required: true, description: "Vault-relative note path" },
          id: { type: "positional", required: true, description: "The thread's root id" },
          reopen: { type: "boolean", description: "Reopen instead of resolving" },
          ...sourceArg,
          ...jsonArg,
        },
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

      remove: defineCommand({
        meta: {
          name: "remove",
          description: "Delete a comment thread's sidecar entries (markers stay yours to strip)",
        },
        args: {
          path: { type: "positional", required: true, description: "Vault-relative note path" },
          id: { type: "positional", required: true, description: "The thread's root id" },
          ...jsonArg,
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
    },
  });
}
