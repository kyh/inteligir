import { TRPCError } from "@trpc/server";
import { eq } from "@repo/db";
import { user } from "@repo/db/drizzle-schema-auth";

import { createTRPCRouter, protectedProcedure } from "../trpc";

export const layoutRouter = createTRPCRouter({
  app: protectedProcedure.query(async ({ ctx }) => {
    const currentUser = await ctx.db.query.user.findFirst({
      where: eq(user.id, ctx.userId),
      columns: {
        id: true,
        name: true,
        image: true,
        email: true,
        username: true,
      },
    });

    if (!currentUser) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }

    return {
      currentUser: {
        ...currentUser,
        firstName: currentUser.name?.split(" ")[0] ?? "You",
      },
    };
  }),
});
