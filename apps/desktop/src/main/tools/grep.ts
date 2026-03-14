import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { statSync, readFileSync } from "node:fs";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const MAX_BYTES = 50 * 1024;
const DEFAULT_LIMIT = 100;
const MAX_LINE_LENGTH = 500;

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(Type.String({ description: "Directory or file to search (default: cwd)" })),
  glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts'" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string (default: false)" })),
  context: Type.Optional(Type.Number({ description: "Lines of context around each match (default: 0)" })),
  limit: Type.Optional(Type.Number({ description: "Max matches to return (default: 100)" })),
});

export function createGrepTool(cwd: string): AgentTool<typeof grepSchema> {
  return {
    name: "grep",
    label: "grep",
    description: `Search file contents for a pattern using ripgrep. Returns matching lines with paths and line numbers. Respects .gitignore. Truncated to ${DEFAULT_LIMIT} matches or ${MAX_BYTES / 1024}KB.`,
    parameters: grepSchema,
    execute: (
      _toolCallId: string,
      params: {
        pattern: string;
        path?: string;
        glob?: string;
        ignoreCase?: boolean;
        literal?: boolean;
        context?: number;
        limit?: number;
      },
      signal?: AbortSignal,
    ): Promise<AgentToolResult<undefined>> => {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }

        const searchPath = params.path
          ? path.isAbsolute(params.path) ? params.path : path.resolve(cwd, params.path)
          : cwd;
        const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_LIMIT);
        const contextLines = params.context && params.context > 0 ? params.context : 0;

        const isDir = (() => {
          try { return statSync(searchPath).isDirectory(); } catch { return false; }
        })();

        const args: string[] = ["--json", "--line-number", "--color=never", "--hidden"];
        if (params.ignoreCase) args.push("--ignore-case");
        if (params.literal) args.push("--fixed-strings");
        if (params.glob) args.push("--glob", params.glob);
        args.push(params.pattern, searchPath);

        const child = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
        const rl = createInterface({ input: child.stdout });

        let stderr = "";
        let matchCount = 0;
        let killedDueToLimit = false;
        const matches: Array<{ filePath: string; lineNumber: number }> = [];

        const onAbort = () => { child.kill(); };
        signal?.addEventListener("abort", onAbort, { once: true });

        child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

        rl.on("line", (line) => {
          if (!line.trim() || matchCount >= effectiveLimit) return;
          let event: Record<string, unknown>;
          try { event = JSON.parse(line) as Record<string, unknown>; } catch { return; }

          if (event.type === "match") {
            matchCount++;
            const data = event.data as Record<string, unknown> | undefined;
            const pathObj = data?.path as Record<string, unknown> | undefined;
            const filePath = pathObj?.text;
            const lineNumber = data?.line_number;
            if (typeof filePath === "string" && typeof lineNumber === "number") {
              matches.push({ filePath, lineNumber });
            }
            if (matchCount >= effectiveLimit) {
              killedDueToLimit = true;
              child.kill();
            }
          }
        });

        child.on("error", (err) => {
          signal?.removeEventListener("abort", onAbort);
          reject(new Error(`Failed to run ripgrep: ${err.message}`));
        });

        child.on("close", (code) => {
          rl.close();
          signal?.removeEventListener("abort", onAbort);

          if (signal?.aborted) {
            reject(new Error("Operation aborted"));
            return;
          }

          if (!killedDueToLimit && code !== 0 && code !== 1) {
            reject(new Error(stderr.trim() || `ripgrep exited with code ${code}`));
            return;
          }

          if (matchCount === 0) {
            resolve({ content: [{ type: "text", text: "No matches found" }], details: undefined });
            return;
          }

          // Format matches with optional context
          const fileCache = new Map<string, string[]>();
          const getLines = (fp: string): string[] => {
            let lines = fileCache.get(fp);
            if (!lines) {
              try { lines = readFileSync(fp, "utf-8").split("\n"); } catch { lines = []; }
              fileCache.set(fp, lines);
            }
            return lines;
          };

          const outputLines: string[] = [];
          for (const { filePath, lineNumber } of matches) {
            const rel = isDir ? path.relative(searchPath, filePath) : path.basename(filePath);
            const lines = getLines(filePath);
            const start = contextLines > 0 ? Math.max(1, lineNumber - contextLines) : lineNumber;
            const end = contextLines > 0 ? Math.min(lines.length, lineNumber + contextLines) : lineNumber;

            for (let i = start; i <= end; i++) {
              const raw = lines[i - 1] ?? "";
              const text = raw.length > MAX_LINE_LENGTH ? raw.slice(0, MAX_LINE_LENGTH) + "…" : raw;
              const sep = i === lineNumber ? ":" : "-";
              outputLines.push(`${rel}${sep}${i}${sep} ${text}`);
            }
          }

          let output = outputLines.join("\n");
          if (Buffer.byteLength(output, "utf-8") > MAX_BYTES) {
            const buf = Buffer.from(output, "utf-8");
            output = buf.subarray(0, MAX_BYTES).toString("utf-8");
            const lastNewline = output.lastIndexOf("\n");
            if (lastNewline > 0) output = output.slice(0, lastNewline);
            output += "\n\n[Output truncated]";
          }

          const notices: string[] = [];
          if (killedDueToLimit) {
            notices.push(`${effectiveLimit} match limit reached`);
          }
          if (notices.length > 0) {
            output += `\n\n[${notices.join(". ")}]`;
          }

          resolve({ content: [{ type: "text", text: output }], details: undefined });
        });
      });
    },
  };
}
