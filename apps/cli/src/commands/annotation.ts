import { randomBytes } from "node:crypto";
import { defineCommand } from "citty";

import type { AnnotationWire } from "@repo/contract/local/annotations/annotations-schema";
import { ANNOTATION_SOURCES, mintAnnotationId } from "@repo/notes/annotations/store-schema";
import type { AnnotationSource } from "@repo/notes/annotations/store-schema";
import { apiFor, isAgentShell } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, outputJson, writeLines } from "../output";

// citty's enum type infers from a mutable array, so the readonly tuple is spread.
const sourceArg = {
  source: {
    description: "Who is writing (default: agent inside an agent shell, else user)",
    options: [...ANNOTATION_SOURCES],
    type: "enum" as const,
  },
};

const sourceFor = (deps: CliDeps, override: AnnotationSource | undefined): AnnotationSource =>
  override ?? (isAgentShell(deps.env) ? "agent" : "user");

const describeAnnotation = (annotation: AnnotationWire): string[] => {
  const quote = annotation.quote === null ? "" : ` "${annotation.quote}"`;
  const head = `${annotation.id} [${annotation.state}]${quote} ${annotation.root.source ?? "unknown"}: ${annotation.root.text}`;
  const replies = annotation.replies.map(
    (reply) => `  ↳ ${reply.id} ${reply.entry.source ?? "unknown"}: ${reply.entry.text}`,
  );
  return [head, ...replies];
};

export const annotationCommand = (deps: CliDeps) =>
  defineCommand({
    meta: { description: "Highlights and notes on a note's text", name: "annotation" },
    subCommands: {
      add: defineCommand({
        // citty binds positionals in declaration order.
        args: {
          path: { description: "Vault-relative note path", required: true, type: "positional" },
          quote: {
            description: "The passage's text, as the annotation records it",
            required: true,
            type: "positional",
          },
          note: { description: "A note on the passage (default: none)", type: "string" },
          ...sourceArg,
          ...jsonArg,
        },
        meta: {
          description:
            "Add an annotation to the note's store (unanchored until markers wrap its passage)",
          name: "add",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const id = mintAnnotationId(randomBytes);
          const body = await api.annotations.add({
            id,
            path: args.path,
            quote: args.quote,
            source: sourceFor(deps, args.source),
            text: args.note ?? "",
          });
          if (outputJson(args, { id, ...body })) {
            return;
          }
          writeLines([`Annotation ${id} added to ${body.path}.`]);
        },
      }),

      edit: defineCommand({
        // citty binds positionals in declaration order.
        args: {
          path: { description: "Vault-relative note path", required: true, type: "positional" },
          id: { description: "The annotation's or reply's id", required: true, type: "positional" },
          text: { description: 'The new note ("" removes it)', required: true, type: "positional" },
          ...sourceArg,
          ...jsonArg,
        },
        meta: { description: "Rewrite an annotation's note or a reply", name: "edit" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.annotations.edit({
            id: args.id,
            path: args.path,
            source: sourceFor(deps, args.source),
            text: args.text,
          });
          if (outputJson(args, body)) {
            return;
          }
          writeLines([`Updated ${args.id}.`]);
        },
      }),

      list: defineCommand({
        args: {
          path: { description: "Vault-relative note path", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "A note's annotations and their replies", name: "list" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.annotations.list({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          if (body.annotations.length === 0) {
            writeLines([`No annotations on ${body.path}.`]);
            return;
          }
          writeLines(body.annotations.flatMap(describeAnnotation));
        },
      }),

      remove: defineCommand({
        // citty binds positionals in declaration order.
        args: {
          path: { description: "Vault-relative note path", required: true, type: "positional" },
          id: { description: "The annotation's root id", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Delete an annotation's store entries (markers stay yours to strip)",
          name: "remove",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.annotations.remove({ id: args.id, path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          writeLines([
            `Annotation ${args.id} removed.`,
            ...(body.removedIds.length > 0
              ? [`Strip its markers from the note: %%i:${body.removedIds.join(",")}:start/end%%`]
              : []),
          ]);
        },
      }),

      reply: defineCommand({
        // citty binds positionals in declaration order.
        args: {
          path: { description: "Vault-relative note path", required: true, type: "positional" },
          parent: { description: "Root or reply id", required: true, type: "positional" },
          text: { description: "The reply text", required: true, type: "positional" },
          ...sourceArg,
          ...jsonArg,
        },
        meta: { description: "Reply under an annotation", name: "reply" },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const id = mintAnnotationId(randomBytes);
          const body = await api.annotations.reply({
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
    },
  });
