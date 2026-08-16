// `inteligir search|backlinks|tags` — read-only queries over the knowledge
// index. `search` passes the raw query through: `tag:<name>` terms are parsed
// ENGINE-side, so a tag typed here narrows exactly like the app's one box.

import { CliExitError } from "../cli-error";
import type { Command } from "commander";
import { apiFor, type CliDeps } from "../context";
import { failFromResponse, outputJson, type JsonOutputOptions } from "../output";

interface SearchOptions extends JsonOutputOptions {
  limit?: string;
}

function parseLimit(rawValue: string | undefined): number | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  const limit = Number(rawValue);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new CliExitError(`--limit must be a positive integer (got "${rawValue}")`);
  }
  return limit;
}

export function registerKnowledgeCommands(program: Command, deps: CliDeps): void {
  program
    .command("search <query>")
    .description("Full-text search; tag:<name> terms narrow by tag")
    .option("--limit <n>", "Maximum results")
    .option("--json", "Print machine-readable JSON output")
    .action(async (query: string, opts: SearchOptions) => {
      const limit = parseLimit(opts.limit);
      const api = await apiFor(deps);
      const response = await api.knowledge.search.$get({
        query: { q: query, ...(limit === undefined ? {} : { limit }) },
      });
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      if (body.results.length === 0) {
        console.log("No results.");
        return;
      }
      for (const result of body.results) {
        console.log(`${result.path}  ${result.title}`);
        if (result.snippet.length > 0) {
          console.log(`  ${result.snippet}`);
        }
      }
    });

  program
    .command("backlinks <path>")
    .description("Notes linking INTO a note")
    .option("--json", "Print machine-readable JSON output")
    .action(async (path: string, opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const response = await api.knowledge.backlinks.$get({ query: { path } });
      if (response.status !== 200) {
        return failFromResponse(response);
      }
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      for (const backlink of body.backlinks) {
        console.log(`${backlink.sourcePath}:${backlink.line}  ${backlink.snippet}`);
      }
      if (body.backlinks.length < body.total) {
        console.log(`(${body.total - body.backlinks.length} more not shown)`);
      }
    });

  program
    .command("tags")
    .description("Every tag with its usage count, most used first")
    .option("--json", "Print machine-readable JSON output")
    .action(async (opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const response = await api.knowledge.tags.$get();
      const body = await response.json();
      if (outputJson(opts, body)) {
        return;
      }
      for (const tag of body.tags) {
        console.log(`${tag.tag}  ${tag.count}`);
      }
      if (body.tags.length < body.total) {
        console.log(`(${body.total - body.tags.length} more not shown)`);
      }
    });
}
