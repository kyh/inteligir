// `inteligir search|backlinks|related|tags` — read-only queries over the knowledge
// index. `search` passes the raw query through: `tag:<name>` terms are parsed
// ENGINE-side, so a tag typed here narrows exactly like the app's one box.
//
// Four TOP-LEVEL commands rather than a group, so four `defineCommand`s in
// one module: what they share is a subject, not a prefix.

import {
  KNOWLEDGE_RELATED_MAX_LIMIT,
  KNOWLEDGE_SEARCH_MAX_LIMIT,
  type KnowledgeRelatedRequest,
  type KnowledgeSearchRequest,
} from "@repo/api/local/knowledge/knowledge-schema";
import { defineCommand } from "citty";
import { parseBoundedInteger } from "../args";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, writeLines } from "../output";

function parseLimit(rawValue: string | undefined, max: number): number | undefined {
  return rawValue === undefined
    ? undefined
    : parseBoundedInteger(rawValue, "--limit", { min: 1, max });
}

export function searchCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "search", description: "Full-text search; tag:<name> terms narrow by tag" },
    args: {
      query: { type: "positional", required: true, description: "The search query" },
      limit: { type: "string", description: "Maximum results" },
      ...jsonArg,
    },
    run: async ({ args }) => {
      const limit = parseLimit(args.limit, KNOWLEDGE_SEARCH_MAX_LIMIT);
      const api = apiFor(deps);
      const request: KnowledgeSearchRequest = { q: args.query };
      if (limit !== undefined) {
        request.limit = limit;
      }
      const body = await api.knowledge.search(request);
      if (outputJson(args, body)) {
        return;
      }
      if (body.results.length === 0) {
        out.info("No results.");
        return;
      }
      writeLines(
        body.results.flatMap((result) =>
          result.snippet.length > 0
            ? [`${result.path}  ${result.title}`, `  ${result.snippet}`]
            : [`${result.path}  ${result.title}`],
        ),
      );
    },
  });
}

export function backlinksCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "backlinks", description: "Notes linking INTO a note" },
    args: {
      path: { type: "positional", required: true, description: "The vault-relative path" },
      ...jsonArg,
    },
    run: async ({ args }) => {
      const api = apiFor(deps);
      const body = await api.knowledge.backlinks({ path: args.path });
      if (outputJson(args, body)) {
        return;
      }
      writeLines([
        ...body.backlinks.map(
          (backlink) => `${backlink.sourcePath}:${backlink.line}  ${backlink.snippet}`,
        ),
        ...(body.backlinks.length < body.total
          ? [`(${body.total - body.backlinks.length} more not shown)`]
          : []),
      ]);
    },
  });
}

export function relatedCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "related", description: "Notes connected to a note, and why" },
    args: {
      path: { type: "positional", required: true, description: "The vault-relative path" },
      limit: { type: "string", description: "Maximum results" },
      ...jsonArg,
    },
    run: async ({ args }) => {
      const limit = parseLimit(args.limit, KNOWLEDGE_RELATED_MAX_LIMIT);
      const api = apiFor(deps);
      const request: KnowledgeRelatedRequest = { path: args.path };
      if (limit !== undefined) {
        request.limit = limit;
      }
      const body = await api.knowledge.related(request);
      if (outputJson(args, body)) {
        return;
      }
      if (body.related.length === 0) {
        out.info("No related notes.");
        return;
      }
      // The reasons ride WITH the row rather than being summarised away: a
      // ranked list of paths is a claim, and the reasons are what make it
      // checkable by whoever reads it.
      writeLines(
        body.related.flatMap((entry) => [
          `${entry.path}  ${entry.title}`,
          `  ${entry.reasons.join("; ")}`,
        ]),
      );
    },
  });
}

export function tagsCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "tags", description: "Every tag with its usage count, most used first" },
    args: { ...jsonArg },
    run: async ({ args }) => {
      const api = apiFor(deps);
      const body = await api.knowledge.tags();
      if (outputJson(args, body)) {
        return;
      }
      writeLines([
        ...body.tags.map((tag) => `${tag.tag}  ${tag.count}`),
        ...(body.tags.length < body.total
          ? [`(${body.total - body.tags.length} more not shown)`]
          : []),
      ]);
    },
  });
}
