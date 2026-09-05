import {
  KNOWLEDGE_MATCHES_MAX_LIMIT,
  KNOWLEDGE_RELATED_MAX_LIMIT,
  KNOWLEDGE_SEARCH_MAX_LIMIT,
  type KnowledgeMatchesRequest,
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

export function matchesCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "matches", description: "Every literal occurrence of a text, with its line" },
    args: {
      text: { type: "positional", required: true, description: "The text to find, one line" },
      "case-sensitive": { type: "boolean", description: "Match case exactly" },
      "whole-word": { type: "boolean", description: "Match whole words only" },
      limit: { type: "string", description: "Maximum matches" },
      ...jsonArg,
    },
    run: async ({ args }) => {
      const limit = parseLimit(args.limit, KNOWLEDGE_MATCHES_MAX_LIMIT);
      const api = apiFor(deps);
      const request: KnowledgeMatchesRequest = { q: args.text };
      if (args["case-sensitive"] === true) {
        request.caseSensitive = true;
      }
      if (args["whole-word"] === true) {
        request.wholeWord = true;
      }
      if (limit !== undefined) {
        request.limit = limit;
      }
      const body = await api.knowledge.matches(request);
      if (outputJson(args, body)) {
        return;
      }
      if (body.matches.length === 0) {
        out.info("No matches.");
        return;
      }
      // columns count from 1 here, as editors do; the wire's are offsets
      writeLines([
        ...body.matches.map(
          (match) =>
            `${match.path}:${match.line}:${match.column + 1}  ${match.before}${match.text}${match.after}`,
        ),
        ...(body.matches.length < body.total
          ? [`(${body.total - body.matches.length} more not shown)`]
          : []),
      ]);
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
