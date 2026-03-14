import fs from "node:fs";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { resolvePath } from "@/main/lib/tool-utils";

const editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit" }),
  old_string: Type.String({
    description: "Exact text to find and replace (must match exactly)",
  }),
  new_string: Type.String({ description: "Replacement text" }),
});

export function createEditTool(cwd: string): AgentTool<typeof editSchema> {
  return {
    name: "edit",
    label: "edit",
    description:
      "Edit a file by replacing exact text. The old_string must match exactly (including whitespace) and be unique in the file.",
    parameters: editSchema,
    execute: async (
      _toolCallId: string,
      params: { path: string; old_string: string; new_string: string },
    ): Promise<AgentToolResult<undefined>> => {
      const filePath = resolvePath(cwd, params.path);

      const content = fs.readFileSync(filePath, "utf-8");

      if (!content.includes(params.old_string)) {
        throw new Error(
          `Could not find the exact text in ${filePath}. Must match exactly including whitespace.`,
        );
      }

      const occurrences = content.split(params.old_string).length - 1;
      if (occurrences > 1) {
        throw new Error(
          `Found ${occurrences} occurrences in ${filePath}. Provide more context to make it unique.`,
        );
      }

      const idx = content.indexOf(params.old_string);
      const newContent =
        content.substring(0, idx) +
        params.new_string +
        content.substring(idx + params.old_string.length);

      if (content === newContent) {
        throw new Error(`No changes — old_string and new_string are identical.`);
      }

      fs.writeFileSync(filePath, newContent, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: `Replaced ${params.old_string.length} chars with ${params.new_string.length} chars in ${filePath}`,
          },
        ],
        details: undefined,
      };
    },
  };
}
