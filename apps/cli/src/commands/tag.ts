import { KNOWLEDGE_TAG_NOTES_MAX_LIMIT } from "@repo/api/local/knowledge/knowledge-schema";
import type { KnowledgeTagNotesRequest } from "@repo/api/local/knowledge/knowledge-schema";
import { defineCommand } from "citty";
import { parseBoundedInteger } from "../args";
import { apiFor } from "../context";
import type { CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

export const tagCommand = (deps: CliDeps) =>
  defineCommand({
    meta: { description: "One tag, across every note", name: "tag" },
    subCommands: {
      notes: defineCommand({
        args: {
          limit: { description: "Page size (1–500, default 100)", type: "string" },
          offset: { description: "Rows to skip, for the next page", type: "string" },
          tag: { description: "The tag, without the #", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Every note holding the tag or one nested under it, by path",
          name: "notes",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const offset =
            args.offset === undefined
              ? 0
              : parseBoundedInteger(args.offset, "--offset", { min: 0 });
          const request: KnowledgeTagNotesRequest = { tag: args.tag };
          if (args.limit !== undefined) {
            request.limit = parseBoundedInteger(args.limit, "--limit", {
              max: KNOWLEDGE_TAG_NOTES_MAX_LIMIT,
              min: 1,
            });
          }
          if (args.offset !== undefined) {
            request.offset = offset;
          }
          const body = await api.knowledge.tagNotes(request);
          if (outputJson(args, body)) {
            return;
          }
          if (body.total === 0) {
            out.info(`No note holds #${body.tag}.`);
            return;
          }
          const shown = offset + body.paths.length;
          writeLines([
            ...body.paths,
            ...(shown < body.total
              ? [`(${body.total - shown} more; pass --offset ${shown} for the next page)`]
              : []),
          ]);
        },
      }),

      rename: defineCommand({
        args: {
          from: { description: "The tag, without the #", required: true, type: "positional" },
          to: { description: "The new name, without the #", required: true, type: "positional" },
          ...jsonArg,
        },
        meta: {
          description: "Rename a tag, and the tags nested under it, in every note that holds it",
          name: "rename",
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const body = await api.knowledge.renameTag({ from: args.from, to: args.to });
          if (outputJson(args, body)) {
            return;
          }
          const count = body.rewritten.length;
          out.success(
            `Renamed #${body.from} to #${body.to} in ${count} note${count === 1 ? "" : "s"}.`,
          );
          for (const skip of body.skipped) {
            out.warn(`Skipped ${skip.path}: ${skip.reason}`);
          }
        },
      }),
    },
  });
