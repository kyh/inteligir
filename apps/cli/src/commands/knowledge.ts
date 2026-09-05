import {
  KNOWLEDGE_MATCHES_MAX_LIMIT,
  KNOWLEDGE_PROBLEMS_MAX_LIMIT,
  KNOWLEDGE_RELATED_MAX_LIMIT,
  KNOWLEDGE_SEARCH_MAX_LIMIT,
  KNOWLEDGE_UNLINKED_MAX_LIMIT,
  type KnowledgeMatchesRequest,
  type KnowledgeProblemsRequest,
  type KnowledgeProblemsResponse,
  type KnowledgeRelatedRequest,
  type KnowledgeSearchRequest,
  type KnowledgeUnlinkedMentionsRequest,
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

export function unlinkedCommand(deps: CliDeps) {
  return defineCommand({
    meta: { name: "unlinked", description: "Notes naming a note in prose without linking it" },
    args: {
      path: { type: "positional", required: true, description: "The vault-relative path" },
      limit: { type: "string", description: "Maximum notes" },
      ...jsonArg,
    },
    run: async ({ args }) => {
      const limit = parseLimit(args.limit, KNOWLEDGE_UNLINKED_MAX_LIMIT);
      const api = apiFor(deps);
      const request: KnowledgeUnlinkedMentionsRequest = { path: args.path };
      if (limit !== undefined) {
        request.limit = limit;
      }
      const body = await api.knowledge.unlinkedMentions(request);
      if (outputJson(args, body)) {
        return;
      }
      if (body.mentions.length === 0) {
        out.info("No unlinked mentions.");
        return;
      }
      // columns count from 1 here, as editors do; the wire's are offsets
      writeLines([
        ...body.mentions.map(
          (mention) =>
            `${mention.path}:${mention.line}:${mention.column + 1}  ${mention.before}${mention.text}${mention.after}${
              mention.count > 1 ? `  (${mention.count} mentions)` : ""
            }`,
        ),
        ...(body.mentions.length < body.total
          ? [`(${body.total - body.mentions.length} more notes not shown)`]
          : []),
      ]);
    },
  });
}

function problemFamilyLines<Row>(
  heading: string,
  family: { rows: readonly Row[]; total: number },
  line: (row: Row) => string,
): string[] {
  if (family.total === 0) return [];
  return [
    `${heading} (${family.total})`,
    ...family.rows.map((row) => `  ${line(row)}`),
    ...(family.rows.length < family.total
      ? [`  (${family.total - family.rows.length} more not shown)`]
      : []),
  ];
}

function problemLines(body: KnowledgeProblemsResponse): string[] {
  return [
    ...problemFamilyLines(
      "Unresolved links",
      body.unresolvedLinks,
      (row) => `[[${row.target}]]  ${row.sourcePath}:${row.line}`,
    ),
    ...problemFamilyLines(
      "Missing embeds",
      body.missingEmbeds,
      (row) => `${row.target}  ${row.sourcePath}:${row.line}`,
    ),
    ...problemFamilyLines("Orphans", body.orphans, (row) => `${row.path}  ${row.title}`),
    ...problemFamilyLines(
      "Duplicate stems",
      body.duplicateStems,
      (row) => `${row.stem}  ${row.paths.join(", ")}`,
    ),
  ];
}

export function problemsCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: "problems",
      description: "Dangling links, missing embeds, orphan notes and duplicate stems",
    },
    args: {
      limit: { type: "string", description: "Maximum rows per family" },
      "include-conventions": {
        type: "boolean",
        description: "Count daily notes and templates as orphans too",
      },
      ...jsonArg,
    },
    run: async ({ args }) => {
      const limit = parseLimit(args.limit, KNOWLEDGE_PROBLEMS_MAX_LIMIT);
      const api = apiFor(deps);
      const request: KnowledgeProblemsRequest = {};
      if (limit !== undefined) {
        request.limit = limit;
      }
      if (args["include-conventions"] === true) {
        request.includeConventionFolders = true;
      }
      const body = await api.knowledge.problems(request);
      if (outputJson(args, body)) {
        return;
      }
      const lines = problemLines(body);
      if (lines.length === 0) {
        out.info("No problems.");
        return;
      }
      writeLines(lines);
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
