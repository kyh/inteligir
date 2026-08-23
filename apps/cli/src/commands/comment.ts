// Anchored-comment verbs over the sidecar routes (#583/#592): list, add,
// reply, resolve, remove. The BODY MARKERS are the editor's (and the agent's
// own shell's, per the inteligir-comments skill) — these verbs touch only
// the sidecar, so `add` from here starts an UNANCHORED thread the panel
// surfaces as such, and `remove` answers which marker ids the caller still
// owes the note.

import { randomBytes } from "node:crypto";
import { defineCommand } from "citty";

import type { CommentThreadWire } from "@repo/server-contract/comments";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, outputJson, requireOk, writeLines } from "../output";

function mintCommentId(): string {
  return `c${randomBytes(5).toString("hex")}`;
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
          const api = await apiFor(deps);
          const response = await requireOk(await api.comments.$get({ query: { path: args.path } }));
          const body = await response.json();
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
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = await apiFor(deps);
          const id = mintCommentId();
          const response = await requireOk(
            await api.comments.add.$post({ json: { id, path: args.path, text: args.text } }),
          );
          const body = await response.json();
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
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = await apiFor(deps);
          const id = mintCommentId();
          const response = await requireOk(
            await api.comments.reply.$post({
              json: { id, parentId: args.parent, path: args.path, text: args.text },
            }),
          );
          const body = await response.json();
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
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = await apiFor(deps);
          const resolved = args.reopen !== true;
          const response = await requireOk(
            await api.comments.resolve.$post({
              json: { id: args.id, path: args.path, resolved },
            }),
          );
          const body = await response.json();
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
          const api = await apiFor(deps);
          const response = await requireOk(
            await api.comments.remove.$post({ json: { id: args.id, path: args.path } }),
          );
          const body = await response.json();
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
