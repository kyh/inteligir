import { and, desc, eq, ilike, isNull } from "@repo/db";
import { document } from "@repo/db/drizzle-schema";
import { z } from "zod";

import { createTRPCRouter, organizationProcedure, protectedProcedure } from "../trpc";
import { filterUndefined, nid } from "../utils";

const MAX_TITLE_LENGTH = 256;
const MAX_CONTENT_LENGTH = 1_000_000; // 1MB of text
const MAX_ICON_LENGTH = 100;

export const documentRouter = createTRPCRouter({
  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(document)
        .set({ isArchived: true })
        .where(and(eq(document.id, input.id), eq(document.userId, ctx.userId)));
    }),

  create: organizationProcedure
    .input(
      z.object({
        contentRich: z.unknown().optional(),
        parentDocumentId: z.string().optional(),
        title: z.string().max(MAX_TITLE_LENGTH, "Title is too long").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = nid();
      await ctx.db.insert(document).values({
        id,
        contentRich: input.contentRich,
        parentDocumentId: input.parentDocumentId ?? null,
        title: input.title,
        userId: ctx.userId,
        organizationId: ctx.organizationId,
      });

      return { id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(document)
        .where(and(eq(document.id, input.id), eq(document.userId, ctx.userId)));
    }),

  restore: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(document)
        .set({ isArchived: false })
        .where(and(eq(document.id, input.id), eq(document.userId, ctx.userId)));
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        content: z.string().max(MAX_CONTENT_LENGTH, "Content is too long").optional(),
        contentRich: z.unknown().optional(),
        coverImage: z.string().max(500).optional(),
        fullWidth: z.boolean().optional(),
        icon: z.string().max(MAX_ICON_LENGTH).nullish(),
        isPublished: z.boolean().optional(),
        lockPage: z.boolean().optional(),
        smallText: z.boolean().optional(),
        textStyle: z.enum(["DEFAULT", "SERIF", "MONO"]).optional(),
        title: z.string().max(MAX_TITLE_LENGTH, "Title is too long").optional(),
        toc: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const updateData = filterUndefined(data);

      await ctx.db
        .update(document)
        .set(updateData)
        .where(and(eq(document.id, id), eq(document.userId, ctx.userId)));
    }),

  document: organizationProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const doc = await ctx.db.query.document.findFirst({
        where: and(eq(document.id, input.id), eq(document.organizationId, ctx.organizationId)),
        columns: {
          id: true,
          contentRich: true,
          coverImage: true,
          fullWidth: true,
          icon: true,
          isArchived: true,
          isPublished: true,
          lockPage: true,
          parentDocumentId: true,
          smallText: true,
          templateId: true,
          textStyle: true,
          title: true,
          toc: true,
          updatedAt: true,
        },
      });

      return { document: doc };
    }),

  documents: organizationProcedure
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).optional(),
        parentDocumentId: z.string().optional(),
        search: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { cursor: _cursor, limit = 50, parentDocumentId, search } = input;

      const conditions = [
        eq(document.isArchived, false),
        eq(document.organizationId, ctx.organizationId),
        parentDocumentId
          ? eq(document.parentDocumentId, parentDocumentId)
          : isNull(document.parentDocumentId),
      ];

      if (search) {
        conditions.push(ilike(document.title, `%${search}%`));
      }

      const docs = await ctx.db.query.document.findMany({
        where: and(...conditions),
        orderBy: [desc(document.createdAt)],
        limit: limit + 1,
        columns: {
          id: true,
          coverImage: true,
          createdAt: true,
          icon: true,
          title: true,
          updatedAt: true,
        },
      });

      let nextCursor: string | undefined;
      if (docs.length > limit) {
        const nextItem = docs.pop();
        nextCursor = nextItem?.id;
      }

      return { documents: docs, nextCursor };
    }),

  trash: organizationProcedure
    .input(z.object({ q: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(document.isArchived, true),
        eq(document.organizationId, ctx.organizationId),
      ];

      if (input.q) {
        conditions.push(ilike(document.title, `%${input.q}%`));
      }

      const docs = await ctx.db.query.document.findMany({
        where: and(...conditions),
        columns: {
          id: true,
          icon: true,
          title: true,
        },
      });

      return { documents: docs };
    }),
});
