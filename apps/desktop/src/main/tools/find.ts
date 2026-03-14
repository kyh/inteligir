import path from "node:path";
import { existsSync } from "node:fs";
import { globSync } from "glob";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const MAX_BYTES = 50 * 1024;
const DEFAULT_LIMIT = 1000;

const findSchema = Type.Object({
  pattern: Type.String({ description: "Glob pattern to match files, e.g. '*.ts', '**/*.json'" }),
  path: Type.Optional(Type.String({ description: "Directory to search in (default: cwd)" })),
  limit: Type.Optional(Type.Number({ description: "Max results (default: 1000)" })),
});

export function createFindTool(cwd: string): AgentTool<typeof findSchema> {
  return {
    name: "find",
    label: "find",
    description: `Search for files by glob pattern. Returns matching paths relative to the search directory. Respects .gitignore. Truncated to ${DEFAULT_LIMIT} results or ${MAX_BYTES / 1024}KB.`,
    parameters: findSchema,
    execute: async (
      _toolCallId: string,
      params: { pattern: string; path?: string; limit?: number },
      signal?: AbortSignal,
    ): Promise<AgentToolResult<undefined>> => {
      if (signal?.aborted) throw new Error("Operation aborted");

      const searchPath = params.path
        ? path.isAbsolute(params.path) ? params.path : path.resolve(cwd, params.path)
        : cwd;
      const effectiveLimit = params.limit ?? DEFAULT_LIMIT;

      if (!existsSync(searchPath)) {
        throw new Error(`Path not found: ${searchPath}`);
      }

      const results = globSync(params.pattern, {
        cwd: searchPath,
        dot: true,
        ignore: ["**/node_modules/**", "**/.git/**"],
        nodir: true,
      });

      if (results.length === 0) {
        return { content: [{ type: "text", text: "No files found matching pattern" }], details: undefined };
      }

      // Sort and limit
      results.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      const limited = results.slice(0, effectiveLimit);
      const limitReached = results.length > effectiveLimit;

      let output = limited.join("\n");

      // Byte truncation
      if (Buffer.byteLength(output, "utf-8") > MAX_BYTES) {
        const buf = Buffer.from(output, "utf-8");
        output = buf.subarray(0, MAX_BYTES).toString("utf-8");
        const lastNewline = output.lastIndexOf("\n");
        if (lastNewline > 0) output = output.slice(0, lastNewline);
        output += "\n\n[Output truncated]";
      }

      if (limitReached) {
        output += `\n\n[${effectiveLimit} results limit reached]`;
      }

      return { content: [{ type: "text", text: output }], details: undefined };
    },
  };
}
