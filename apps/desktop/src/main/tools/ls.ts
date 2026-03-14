import path from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const MAX_BYTES = 50 * 1024;
const DEFAULT_LIMIT = 500;

const lsSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to list (default: cwd)" })),
  limit: Type.Optional(Type.Number({ description: "Max entries (default: 500)" })),
});

export function createLsTool(cwd: string): AgentTool<typeof lsSchema> {
  return {
    name: "ls",
    label: "ls",
    description: `List directory contents. Sorted alphabetically, '/' suffix for directories. Includes dotfiles. Truncated to ${DEFAULT_LIMIT} entries or ${MAX_BYTES / 1024}KB.`,
    parameters: lsSchema,
    execute: async (
      _toolCallId: string,
      params: { path?: string; limit?: number },
      signal?: AbortSignal,
    ): Promise<AgentToolResult<undefined>> => {
      if (signal?.aborted) throw new Error("Operation aborted");

      const dirPath = params.path
        ? path.isAbsolute(params.path) ? params.path : path.resolve(cwd, params.path)
        : cwd;
      const effectiveLimit = params.limit ?? DEFAULT_LIMIT;

      if (!existsSync(dirPath)) {
        throw new Error(`Path not found: ${dirPath}`);
      }

      const stat = statSync(dirPath);
      if (!stat.isDirectory()) {
        throw new Error(`Not a directory: ${dirPath}`);
      }

      const entries = readdirSync(dirPath);
      entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

      const lines: string[] = [];
      for (const entry of entries) {
        if (lines.length >= effectiveLimit) break;
        const fullPath = path.join(dirPath, entry);
        try {
          const entryStat = statSync(fullPath);
          lines.push(entryStat.isDirectory() ? entry + "/" : entry);
        } catch {
          lines.push(entry);
        }
      }

      if (lines.length === 0) {
        return { content: [{ type: "text", text: "(empty directory)" }], details: undefined };
      }

      let output = lines.join("\n");
      const limitReached = entries.length > effectiveLimit;

      if (Buffer.byteLength(output, "utf-8") > MAX_BYTES) {
        const buf = Buffer.from(output, "utf-8");
        output = buf.subarray(0, MAX_BYTES).toString("utf-8");
        const lastNewline = output.lastIndexOf("\n");
        if (lastNewline > 0) output = output.slice(0, lastNewline);
        output += "\n\n[Output truncated]";
      }

      if (limitReached) {
        output += `\n\n[${effectiveLimit} entries limit reached]`;
      }

      return { content: [{ type: "text", text: output }], details: undefined };
    },
  };
}
