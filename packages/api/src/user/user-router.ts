import { TRPCError } from "@trpc/server";
import { asc, eq, ilike, or } from "@repo/db";
import { user } from "@repo/db/drizzle-schema-auth";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 255;
const MAX_PROFILE_IMAGE_URL_LENGTH = 500;

export const userRouter = createTRPCRouter({
  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(user).where(eq(user.id, ctx.userId));
    return { success: true };
  }),

  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const userData = await ctx.db.query.user.findFirst({
      where: eq(user.id, ctx.userId),
      columns: {
        email: true,
        name: true,
        image: true,
      },
    });

    if (!userData) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }

    return userData;
  }),

  getUser: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userData = await ctx.db.query.user.findFirst({
        where: eq(user.id, input.id),
        columns: {
          email: true,
          name: true,
          image: true,
        },
      });

      return userData;
    }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        email: z
          .string()
          .email()
          .max(MAX_EMAIL_LENGTH, "Email is too long")
          .optional(),
        name: z
          .string()
          .min(1, "Name is required")
          .max(MAX_NAME_LENGTH, "Name is too long")
          .trim()
          .optional(),
        image: z
          .string()
          .url("Invalid URL")
          .max(MAX_PROFILE_IMAGE_URL_LENGTH, "Profile image URL is too long")
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updateData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) {
          updateData[key] = value;
        }
      }

      const [updated] = await ctx.db
        .update(user)
        .set(updateData)
        .where(eq(user.id, ctx.userId))
        .returning();

      return updated;
    }),

  users: protectedProcedure
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(10),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { limit, search } = input;

      const conditions = search
        ? or(
            ilike(user.name, `%${search}%`),
            ilike(user.email, `%${search}%`)
          )
        : undefined;

      const users = await ctx.db.query.user.findMany({
        where: conditions,
        orderBy: [asc(user.name)],
        limit: limit + 1,
        columns: {
          id: true,
          email: true,
          name: true,
          image: true,
        },
      });

      let nextCursor: string | undefined;
      if (users.length > limit) {
        const nextItem = users.pop();
        nextCursor = nextItem?.id;
      }

      return { items: users, nextCursor };
    }),
});
