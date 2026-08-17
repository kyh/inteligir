// `inteligir search|backlinks|tags` — read-only queries over the knowledge
// index. `search` passes the raw query through: `tag:<name>` terms are parsed
// ENGINE-side, so a tag typed here narrows exactly like the app's one box.

import { KNOWLEDGE_SEARCH_MAX_LIMIT } from "@repo/server-contract/knowledge";
import type { Command } from "commander";
import { invalidUsage } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { outputJson, requireOk, type JsonOutputOptions } from "../output";

interface SearchOptions extends JsonOutputOptions {
  limit?: string;
}

/** Bounded HERE as well as server-side: an out-of-range limit is the caller's
 *  own mistake, and naming the ceiling beats relaying a 400. */
function parseLimit(rawValue: string | undefined): number | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  const limit = Number(rawValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > KNOWLEDGE_SEARCH_MAX_LIMIT) {
    throw invalidUsage(
      `--limit must be an integer between 1 and ${KNOWLEDGE_SEARCH_MAX_LIMIT} (got "${rawValue}")`,
    );
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
      const found = await requireOk(
        await api.knowledge.search.$get({
          query: { q: query, ...(limit === undefined ? {} : { limit }) },
        }),
      );
      const body = await found.json();
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
      const linked = await requireOk(await api.knowledge.backlinks.$get({ query: { path } }));
      const body = await linked.json();
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
      const body = await (await requireOk(await api.knowledge.tags.$get())).json();
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
