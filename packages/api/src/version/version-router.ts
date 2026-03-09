import { TRPCError } from "@trpc/server";
import { desc, eq } from "@repo/db";
import { document, documentVersion } from "@repo/db/drizzle-schema";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { nid } from "../utils";

export const versionRouter = createTRPCRouter({
  createVersion: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.db.query.document.findFirst({
        where: eq(document.id, input.documentId),
        columns: {
          contentRich: true,
          templateId: true,
          title: true,
        },
      });

      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      }

      const id = nid();
      await ctx.db.insert(documentVersion).values({
        id,
        contentRich: doc.contentRich,
        documentId: input.documentId,
        title: doc.title,
        userId: ctx.userId,
      });

      return { id };
    }),

  deleteVersion: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(documentVersion).where(eq(documentVersion.id, input.id));
    }),

  restoreVersion: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const version = await ctx.db.query.documentVersion.findFirst({
        where: eq(documentVersion.id, input.id),
        columns: {
          contentRich: true,
          documentId: true,
          title: true,
        },
      });

      if (!version) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Version not found" });
      }

      await ctx.db
        .update(document)
        .set({
          contentRich: version.contentRich,
          title: version.title,
        })
        .where(eq(document.id, version.documentId));

      return { success: true };
    }),

  documentVersion: protectedProcedure
    .input(z.object({ documentVersionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const version = await ctx.db.query.documentVersion.findFirst({
        where: eq(documentVersion.id, input.documentVersionId),
        columns: {
          id: true,
          contentRich: true,
          createdAt: true,
          documentId: true,
          title: true,
        },
        with: {
          user: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!version) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Version not found" });
      }

      return {
        ...version,
        userId: version.user.id,
        name: version.user.name,
      };
    }),

  documentVersions: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const versions = await ctx.db.query.documentVersion.findMany({
        where: eq(documentVersion.documentId, input.documentId),
        orderBy: [desc(documentVersion.createdAt)],
        columns: {
          id: true,
          contentRich: true,
          createdAt: true,
          title: true,
        },
        with: {
          user: {
            columns: {
              id: true,
              image: true,
              name: true,
            },
          },
        },
      });

      return {
        versions: versions.map((v) => ({
          ...v,
          image: v.user.image,
          userId: v.user.id,
          name: v.user.name,
        })),
      };
    }),
});
