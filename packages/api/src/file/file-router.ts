import { file } from "@repo/db/drizzle-schema";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";

export const fileRouter = createTRPCRouter({
  createFile: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        appUrl: z.string(),
        documentId: z.string(),
        size: z.number(),
        type: z.string(),
        url: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.insert(file).values({
        id: input.id,
        appUrl: input.appUrl,
        documentId: input.documentId,
        size: input.size,
        type: input.type,
        url: input.url,
        userId: ctx.userId,
      });

      return { id: input.id };
    }),
});
