import type { KnowledgeTagNotesRequest } from "@repo/api/local/knowledge/knowledge-schema";
import { defineCommand } from "citty";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

export function tagCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "tag", description: "One tag, across every note" },
    subCommands: {
      notes: defineCommand({
        meta: {
          name: "notes",
          description: "Every note holding the tag or one nested under it, by path",
        },
        args: {
          tag: { type: "positional", required: true, description: "The tag, without the #" },
          limit: { type: "string", description: "Page size (1–500, default 100)" },
          offset: { type: "string", description: "Rows to skip, for the next page" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = apiFor(deps);
          const offset = args.offset === undefined ? 0 : Number(args.offset);
          const request: KnowledgeTagNotesRequest = { tag: args.tag };
          if (args.limit !== undefined) request.limit = Number(args.limit);
          if (args.offset !== undefined) request.offset = offset;
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
        meta: {
          name: "rename",
          description: "Rename a tag, and the tags nested under it, in every note that holds it",
        },
        args: {
          from: { type: "positional", required: true, description: "The tag, without the #" },
          to: { type: "positional", required: true, description: "The new name, without the #" },
          ...jsonArg,
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
}
