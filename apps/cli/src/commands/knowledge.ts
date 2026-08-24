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
} from "@repo/server-contract/knowledge";
import { defineCommand } from "citty";
import { invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, requireOk, writeLines } from "../output";

/** Bounded HERE as well as server-side: an out-of-range limit is the caller's
 *  own mistake, and naming the ceiling beats relaying a 400. The ceiling is
 *  the contract's, per route — never a number this file picked. */
function parseLimit(rawValue: string | undefined, max: number): number | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  const limit = Number(rawValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw invalidUsage(`--limit must be an integer between 1 and ${max} (got "${rawValue}")`);
  }
  return limit;
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
      const query: KnowledgeSearchRequest = { q: args.query };
      if (limit !== undefined) {
        query.limit = limit;
      }
      const found = await requireOk(await api.knowledge.search.$get({ query }));
      const body = await found.json();
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
      const linked = await requireOk(
        await api.knowledge.backlinks.$get({ query: { path: args.path } }),
      );
      const body = await linked.json();
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
      const query: KnowledgeRelatedRequest = { path: args.path };
      if (limit !== undefined) {
        query.limit = limit;
      }
      const found = await requireOk(await api.knowledge.related.$get({ query }));
      const body = await found.json();
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
      const body = await (await requireOk(await api.knowledge.tags.$get())).json();
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
