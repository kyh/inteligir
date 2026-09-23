// its own module: the worker is a separate bundle entry, and a type shared through the runtime
// would drag the store and the vault into the worker bundle. every frame is parsed by the side
// that receives it.

import type { DocProjection } from "@repo/notes/knowledge/projection";
import { docProjectionSchema } from "@repo/notes/knowledge/projection-row";
import type { DocSearchColumns } from "@repo/notes/knowledge/search-columns";
import { z } from "zod";

export interface DocSource {
  path: string;
  content: string;
}

// computeRenameEdits' arguments, by name
export interface RenameEditsJob {
  docs: ReadonlyMap<string, string>;
  allFiles: readonly string[];
  aliasEntries: readonly (readonly [alias: string, path: string])[];
  from: string;
  to: string;
}

// computeTagRenameEdits' arguments, by name
export interface TagRenameEditsJob {
  docs: ReadonlyMap<string, string>;
  from: string;
  to: string;
}

export type ProjectionJob =
  | { kind: "project"; docs: readonly DocSource[] }
  | ({ kind: "rename-edits" } & RenameEditsJob)
  | ({ kind: "tag-rename-edits" } & TagRenameEditsJob);

// several requests can be in flight, so every answer echoes its request's id
export type ProjectionRequest = ProjectionJob & { id: number };

// one doc the scan cannot take (a stack-deep nesting overflows it) answers for itself alone
export type ProjectedDoc =
  | { kind: "projected"; projection: DocProjection; search: DocSearchColumns }
  | { kind: "unprojectable"; reason: string };

export type ProjectionResult =
  | { kind: "projected"; docs: ProjectedDoc[] }
  | { kind: "edits"; edits: Map<string, string> }
  | { kind: "failed"; reason: string };

export type ProjectionAnswer = ProjectionResult & { id: number };

const requestId = z.number().int().nonnegative();
const docs = z.map(z.string(), z.string());

export const projectionRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    docs: z.array(z.object({ content: z.string(), path: z.string() })),
    id: requestId,
    kind: z.literal("project"),
  }),
  z.object({
    aliasEntries: z.array(z.tuple([z.string(), z.string()])),
    allFiles: z.array(z.string()),
    docs,
    from: z.string(),
    id: requestId,
    kind: z.literal("rename-edits"),
    to: z.string(),
  }),
  z.object({
    docs,
    from: z.string(),
    id: requestId,
    kind: z.literal("tag-rename-edits"),
    to: z.string(),
  }),
]) satisfies z.ZodType<ProjectionRequest>;

const searchColumnsSchema = z.object({
  body: z.string(),
  bodyStems: z.string(),
  headingStems: z.string(),
  headings: z.string(),
  title: z.string(),
  titleStems: z.string(),
}) satisfies z.ZodType<DocSearchColumns>;

export const projectionAnswerSchema = z.discriminatedUnion("kind", [
  z.object({
    docs: z.array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("projected"),
          projection: docProjectionSchema,
          search: searchColumnsSchema,
        }),
        z.object({ kind: z.literal("unprojectable"), reason: z.string() }),
      ]),
    ),
    id: requestId,
    kind: z.literal("projected"),
  }),
  z.object({ edits: docs, id: requestId, kind: z.literal("edits") }),
  z.object({ id: requestId, kind: z.literal("failed"), reason: z.string() }),
]) satisfies z.ZodType<ProjectionAnswer>;
