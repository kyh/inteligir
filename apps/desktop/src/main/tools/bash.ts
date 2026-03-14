import { execFile } from "node:child_process";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { MAX_OUTPUT_BYTES, MAX_OUTPUT_LINES, truncateTail } from "./util";

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional)" }),
  ),
});

export function createBashTool(cwd: string): AgentTool<typeof bashSchema> {
  return {
    name: "bash",
    label: "bash",
    description: `Execute a bash command. Returns stdout+stderr. Output truncated to last ${MAX_OUTPUT_LINES} lines or ${MAX_OUTPUT_BYTES / 1024}KB.`,
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
