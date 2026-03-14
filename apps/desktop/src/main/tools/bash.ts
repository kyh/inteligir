import { execFile } from "node:child_process";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional)" }),
  ),
});

function truncateTail(output: string): {
  content: string;
  truncated: boolean;
} {
  const bytes = Buffer.byteLength(output, "utf-8");
  if (bytes <= MAX_BYTES) {
    const lines = output.split("\n");
    if (lines.length <= MAX_LINES) {
      return { content: output, truncated: false };
    }
    return {
      content: lines.slice(-MAX_LINES).join("\n"),
      truncated: true,
    };
  }
  // Byte-truncate: take last MAX_BYTES
  const buf = Buffer.from(output, "utf-8");
  const sliced = buf.subarray(buf.length - MAX_BYTES).toString("utf-8");
  // Drop partial first line
  const idx = sliced.indexOf("\n");
  return {
    content: idx >= 0 ? sliced.substring(idx + 1) : sliced,
    truncated: true,
  };
}

export function createBashTool(cwd: string): AgentTool<typeof bashSchema> {
  return {
    name: "bash",
    label: "bash",
    description: `Execute a bash command. Returns stdout+stderr. Output truncated to last ${MAX_LINES} lines or ${MAX_BYTES / 1024}KB.`,
    parameters: bashSchema,
    execute: (
      _toolCallId: string,
      params: { command: string; timeout?: number },
      signal?: AbortSignal,
    ): Promise<AgentToolResult<undefined>> => {
      return new Promise((resolve, reject) => {
        const child = execFile(
          "/bin/bash",
          ["-c", params.command],
          {
            cwd,
            maxBuffer: 10 * 1024 * 1024,
            timeout: params.timeout ? params.timeout * 1000 : undefined,
            signal,
          },
          (error, stdout, stderr) => {
            let output = "";
            if (stdout) output += stdout;
            if (stderr) {
              if (output) output += "\n";
              output += stderr;
            }

            const { content, truncated } = truncateTail(output);
            let text = content || "(no output)";

            if (truncated) {
              text += "\n\n[Output truncated]";
            }

            if (error && !signal?.aborted) {
              const code =
                "code" in error && typeof error.code === "number"
                  ? error.code
                  : 1;
              reject(
                new Error(`${text}\n\nCommand exited with code ${code}`.trim()),
              );
              return;
            }

            resolve({
              content: [{ type: "text", text }],
              details: undefined,
            });
          },
        );

        signal?.addEventListener(
          "abort",
          () => {
            child.kill("SIGTERM");
          },
          { once: true },
        );
      });
    },
  };
}
