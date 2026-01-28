import { desc, eq } from "@repo/db";
import { comment, discussion } from "@repo/db/drizzle-schema";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { nid } from "../utils";

const MAX_DOCUMENT_CONTENT_LENGTH = 1000;

export const commentRouter = createTRPCRouter({
  createComment: protectedProcedure
    .input(
      z.object({
        contentRich: z.array(z.unknown()).optional(),
        discussionId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = nid();
      await ctx.db.insert(comment).values({
        id,
        content: "", // Plain text version, can be computed from contentRich
        contentRich: input.contentRich,
        discussionId: input.discussionId,
        userId: ctx.userId,
      });

      return { id };
    }),

  createDiscussion: protectedProcedure
    .input(
      z.object({
        documentContent: z
          .string()
          .min(1, "Document content cannot be empty")
          .max(MAX_DOCUMENT_CONTENT_LENGTH, "Selected text is too long"),
        documentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = nid();
      await ctx.db.insert(discussion).values({
        id,
        documentContent: input.documentContent,
        documentId: input.documentId,
        userId: ctx.userId,
      });

      return { id };
    }),

  createDiscussionWithComment: protectedProcedure
    .input(
      z.object({
        contentRich: z.array(z.unknown()).optional(),
        discussionId: z.string().optional(),
        documentContent: z
          .string()
          .min(1, "Document content cannot be empty")
          .max(MAX_DOCUMENT_CONTENT_LENGTH, "Selected text is too long"),
        documentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const discussionId = input.discussionId ?? nid();

      await ctx.db.insert(discussion).values({
        id: discussionId,
        documentContent: input.documentContent,
        documentId: input.documentId,
        userId: ctx.userId,
      });

      await ctx.db.insert(comment).values({
        id: nid(),
        content: "",
        contentRich: input.contentRich,
        discussionId,
        userId: ctx.userId,
      });

      return { id: discussionId };
    }),

  deleteComment: protectedProcedure
    .input(z.object({ id: z.string(), discussionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(comment).where(eq(comment.id, input.id));
    }),

  removeDiscussion: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(discussion).where(eq(discussion.id, input.id));
    }),

  resolveDiscussion: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(discussion)
        .set({ isResolved: true })
        .where(eq(discussion.id, input.id));
    }),

  updateComment: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        contentRich: z.array(z.unknown()).optional(),
        discussionId: z.string(),
        isEdited: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(comment)
        .set({
          contentRich: input.contentRich,
          isEdited: input.isEdited,
        })
        .where(eq(comment.id, input.id));
    }),

  discussions: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const discussions = await ctx.db.query.discussion.findMany({
        where: eq(discussion.documentId, input.documentId),
        orderBy: [desc(discussion.createdAt)],
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              image: true,
            },
          },
          comments: {
            orderBy: (c, { asc }) => [asc(c.createdAt)],
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          },
        },
      });

      return { discussions };
    }),
});
