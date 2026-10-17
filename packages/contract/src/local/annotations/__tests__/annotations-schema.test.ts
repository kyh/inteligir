import { describe, expect, it } from "vitest";
import { ANNOTATION_SOURCES } from "@repo/notes/annotations/store-schema";
import {
  annotationsAddRequestSchema,
  annotationsEditRequestSchema,
  annotationsReplyRequestSchema,
} from "../annotations-schema";

describe("an annotation write's source", () => {
  const add = { id: "c1", path: "notes/plan.md", quote: "the plan", text: "x" };
  const writes = [
    { request: add, schema: annotationsAddRequestSchema },
    { request: { id: add.id, path: add.path, text: "y" }, schema: annotationsEditRequestSchema },
    {
      request: { id: add.id, parentId: "c0", path: add.path, text: "x" },
      schema: annotationsReplyRequestSchema,
    },
  ];

  it("is optional — a caller that says nothing is signed by the server", () => {
    for (const { schema, request } of writes) {
      expect(schema.safeParse(request).success).toBe(true);
    }
  });

  it("is the store's own vocabulary on every writing row, and nothing outside it", () => {
    for (const { schema, request } of writes) {
      for (const source of ANNOTATION_SOURCES) {
        expect(schema.safeParse({ ...request, source }).success).toBe(true);
      }
      expect(schema.safeParse({ ...request, source: "robot" }).success).toBe(false);
    }
  });
});

describe("an annotation's add", () => {
  it("takes a bare highlight: a quote with no note", () => {
    const parsed = annotationsAddRequestSchema.safeParse({
      id: "h1",
      path: "notes/plan.md",
      quote: "the plan",
    });
    expect(parsed.success && parsed.data.text).toBe("");
  });

  it("refuses a highlight with no passage", () => {
    for (const quote of ["", "   "]) {
      expect(
        annotationsAddRequestSchema.safeParse({ id: "h1", path: "notes/plan.md", quote }).success,
      ).toBe(false);
    }
  });
});
