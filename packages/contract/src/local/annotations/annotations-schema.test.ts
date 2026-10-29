import { describe, expect, it } from "vitest";
import { ANNOTATION_QUOTE_MAX, ANNOTATION_SOURCES } from "@repo/notes/annotations/store-schema";
import {
  annotationsAddRequestSchema,
  annotationsEditRequestSchema,
  annotationsRemoveRequestSchema,
  annotationsReplyRequestSchema,
} from "./annotations-schema";

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

describe("an annotation's quote and placement", () => {
  const add = { id: "h1", path: "notes/plan.md", quote: "the plan" };

  it("holds the quote to the length every writer clips to", () => {
    expect(
      annotationsAddRequestSchema.safeParse({ ...add, quote: "x".repeat(ANNOTATION_QUOTE_MAX) })
        .success,
    ).toBe(true);
    expect(
      annotationsAddRequestSchema.safeParse({ ...add, quote: "x".repeat(ANNOTATION_QUOTE_MAX + 1) })
        .success,
    ).toBe(false);
  });

  it("places on the first occurrence unless told another", () => {
    const parsed = annotationsAddRequestSchema.safeParse({ ...add, place: {} });
    expect(parsed.success && parsed.data.place).toEqual({ occurrence: 1 });
    expect(
      annotationsAddRequestSchema.safeParse({ ...add, place: { occurrence: 0 } }).success,
    ).toBe(false);
  });

  it("leaves the markers to the editor unless the remove asks the server to strip them", () => {
    const parsed = annotationsRemoveRequestSchema.safeParse({ id: "h1", path: "notes/plan.md" });
    expect(parsed.success && parsed.data.stripMarkers).toBe(false);
  });
});
