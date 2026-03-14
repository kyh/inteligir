import fs from "node:fs";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write" }),
  content: Type.String({ description: "Content to write to the file" }),
});

export function createWriteTool(cwd: string): AgentTool<typeof writeSchema> {
  return {
    name: "write",
    label: "write",
    description:
      "Write content to a file. Creates the file and parent directories if needed, overwrites if exists.",
    parameters: writeSchema,
    execute: async (
      _toolCallId: string,
      params: { path: string; content: string },
    ): Promise<AgentToolResult<undefined>> => {
      const filePath = path.isAbsolute(params.path)
        ? params.path
        : path.resolve(cwd, params.path);

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, params.content, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: `Wrote ${params.content.length} bytes to ${filePath}`,
          },
        ],
        details: undefined,
      };
    },
  };
}
