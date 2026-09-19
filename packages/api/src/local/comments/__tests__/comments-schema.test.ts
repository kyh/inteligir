import { describe, expect, it } from "vitest";
import { COMMENT_SOURCES } from "@repo/notes/comments/sidecar-schema";
import {
  commentsAddRequestSchema,
  commentsReplyRequestSchema,
  commentsResolveRequestSchema,
} from "../comments-schema";

describe("a comment write's source", () => {
  const add = { id: "c1", path: "notes/plan.md", text: "x" };
  const writes = [
    { request: add, schema: commentsAddRequestSchema },
    { request: { ...add, parentId: "c0" }, schema: commentsReplyRequestSchema },
    {
      request: { id: add.id, path: add.path, resolved: true },
      schema: commentsResolveRequestSchema,
    },
  ];

  it("is optional — a caller that says nothing is signed by the server", () => {
    for (const { schema, request } of writes) {
      expect(schema.safeParse(request).success).toBe(true);
    }
  });

  it("is the sidecar's own vocabulary on every writing row, and nothing outside it", () => {
    for (const { schema, request } of writes) {
      for (const source of COMMENT_SOURCES) {
        expect(schema.safeParse({ ...request, source }).success).toBe(true);
      }
      expect(schema.safeParse({ ...request, source: "robot" }).success).toBe(false);
    }
  });
});
