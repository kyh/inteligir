import { randomBytes } from "node:crypto";
import { defineCommand } from "citty";

import type { AnnotationWire } from "@repo/contract/local/annotations/annotations-schema";
import { mintAnnotationId } from "@repo/notes/annotations/store-schema";
import type { AnnotationSource } from "@repo/notes/annotations/store-schema";
import { parseBoundedInteger } from "../args";
import { apiFor, isAgentShell } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

// an agent's shell signs its entries; any other caller leaves the server to sign them `user`
const sourceFor = (deps: CliDeps): AnnotationSource | undefined =>
  isAgentShell(deps.env) ? "agent" : undefined;

// id⇥state⇥"quote"⇥note, then its replies beneath it
const describeAnnotation = (annotation: AnnotationWire): string[] => [
  [annotation.id, annotation.state, `"${annotation.quote ?? ""}"`, annotation.root.text].join("\t"),
  ...annotation.replies.map((reply) => `  ↳ ${reply.id}\t${reply.entry.text}`),
];

export const annotationCommand = (deps: CliDeps) =>
  defineCommand({
    meta: { description: "Highlights and notes on an item's text", name: "annotation" },
    subCommands: {
      add: defineCommand({
        // citty binds positionals in declaration order.
        args: {
          path: {
            description: "The item's path in the library",
            required: true,
            type: "positional",
          },
          quote: {
            description: "The passage to highlight, as its text reads",
            required: true,
            type: "positional",
          },
          note: { description: "A note on the passage (default: none)", type: "string" },
          occurrence: {
            description: "Which occurrence of the passage to highlight (default 1, the first)",
            type: "string",
          },
          ...jsonArg,
        },
        meta: {
          description: "Highlight a passage of an item's text, with an optional note",
          name: "add",
        },
        run: async ({ args }) => {
          const occurrence =
            args.occurrence === undefined
              ? 1
              : parseBoundedInteger(args.occurrence, "--occurrence", { min: 1 });
          const id = mintAnnotationId(randomBytes);
          const body = await apiFor(deps).annotations.add({
            id,
            path: args.path,
            place: { occurrence },
            quote: args.quote,
            source: sourceFor(deps),
            text: args.note ?? "",
          });
          if (outputJson(args, body)) {
            return;
          }
          writeLines([`Highlighted "${args.quote}" in ${body.path} (${id})`]);
        },
      }),

      edit: defineCommand({
        // citty binds positionals in declaration order.
        args: {
          path: {
            description: "The item's path in the library",
            required: true,
            type: "positional",
          },
          id: { description: "The annotation's or reply's id", required: true, type: "positional" },
          text: { description: 'The new note ("" removes it)', required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Rewrite an annotation's note or a reply", name: "edit" },
        run: async ({ args }) => {
          const body = await apiFor(deps).annotations.edit({
            id: args.id,
            path: args.path,
            source: sourceFor(deps),
            text: args.text,
          });
          if (outputJson(args, body)) {
            return;
          }
          writeLines([`Updated ${args.id}`]);
        },
      }),

      list: defineCommand({
        args: {
          path: {
            description: "The item's path in the library",
            required: true,
            type: "positional",
          },
          ...jsonArg,
        },
        meta: { description: "An item's highlights, their notes and replies", name: "list" },
        run: async ({ args }) => {
          const body = await apiFor(deps).annotations.list({ path: args.path });
          if (outputJson(args, body)) {
            return;
          }
          if (body.annotations.length === 0) {
            out.info(`No highlights on ${body.path}.`);
            return;
          }
          writeLines(body.annotations.flatMap(describeAnnotation));
        },
      }),

      remove: defineCommand({
        // citty binds positionals in declaration order.
        args: {
          path: {
            description: "The item's path in the library",
            required: true,
            type: "positional",
          },
          id: { description: "The annotation's root id", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Remove a highlight: its markers in the text and its note and replies",
          name: "remove",
        },
        run: async ({ args }) => {
          const body = await apiFor(deps).annotations.remove({
            id: args.id,
            path: args.path,
            stripMarkers: true,
          });
          if (outputJson(args, body)) {
            return;
          }
          writeLines([`Removed highlight ${args.id}`]);
        },
      }),

      reply: defineCommand({
        // citty binds positionals in declaration order.
        args: {
          path: {
            description: "The item's path in the library",
            required: true,
            type: "positional",
          },
          parent: { description: "Root or reply id", required: true, type: "positional" },
          text: { description: "The reply text", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: { description: "Reply under an annotation", name: "reply" },
        run: async ({ args }) => {
          const body = await apiFor(deps).annotations.reply({
            id: mintAnnotationId(randomBytes),
            parentId: args.parent,
            path: args.path,
            source: sourceFor(deps),
            text: args.text,
          });
          if (outputJson(args, body)) {
            return;
          }
          writeLines([`Replied to ${args.parent}`]);
        },
      }),
    },
  });
