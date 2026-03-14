import fs from "node:fs";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { MAX_OUTPUT_BYTES, MAX_OUTPUT_LINES, resolvePath } from "./util";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const readSchema = Type.Object({
  path: Type.String({ description: "Absolute or relative path to the file" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start from (1-indexed)" }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of lines to read" }),
  ),
});

export function createReadTool(cwd: string): AgentTool<typeof readSchema> {
  return {
    name: "read",
    label: "read",
    description: `Read a file. Supports text and images (jpg, png, gif, webp). Text truncated to ${MAX_OUTPUT_LINES} lines or ${MAX_OUTPUT_BYTES / 1024}KB. Use offset/limit for large files.`,
    parameters: readSchema,
    execute: async (
      _toolCallId: string,
      params: { path: string; offset?: number; limit?: number },
    ): Promise<AgentToolResult<undefined>> => {
      const filePath = resolvePath(cwd, params.path);

      const ext = path.extname(filePath).toLowerCase();
      const mimeType = IMAGE_MIME_TYPES[ext];

      if (mimeType) {
        const data = fs.readFileSync(filePath);
        const base64 = data.toString("base64");
        return {
          content: [
            { type: "text", text: `Read image file [${mimeType}]` },
            { type: "image", data: base64, mimeType },
          ],
          details: undefined,
        };
      }

      const raw = fs.readFileSync(filePath, "utf-8");
      const allLines = raw.split("\n");
      const totalLines = allLines.length;

      const startLine = params.offset ? Math.max(1, params.offset) : 1;
      if (startLine > totalLines) {
        throw new Error(
          `Offset ${params.offset} beyond end of file (${totalLines} lines)`,
        );
      }

      let selected = allLines.slice(startLine - 1);

      if (params.limit !== undefined) {
        selected = selected.slice(0, params.limit);
      }

      let content = selected.join("\n");
      let truncated = false;

      if (selected.length > MAX_OUTPUT_LINES) {
        content = selected.slice(0, MAX_OUTPUT_LINES).join("\n");
        truncated = true;
      }

      if (Buffer.byteLength(content, "utf-8") > MAX_OUTPUT_BYTES) {
        const buf = Buffer.from(content, "utf-8");
        content = buf.subarray(0, MAX_OUTPUT_BYTES).toString("utf-8");
        const lastNewline = content.lastIndexOf("\n");
        if (lastNewline > 0) {
          content = content.substring(0, lastNewline);
        }
        truncated = true;
      }

      const endLine = startLine + content.split("\n").length - 1;

      if (truncated) {
        const nextOffset = endLine + 1;
        content += `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines}. Use offset=${nextOffset} to continue]`;
      } else if (endLine < totalLines && params.limit !== undefined) {
        const remaining = totalLines - endLine;
        const nextOffset = endLine + 1;
        content += `\n\n[${remaining} more lines. Use offset=${nextOffset} to continue]`;
      }

      return {
        content: [{ type: "text", text: content }],
        details: undefined,
      };
    },
  };
}
