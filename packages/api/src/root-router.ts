import { commentRouter } from "./comment/comment-router";
import { documentRouter } from "./document/document-router";
import { fileRouter } from "./file/file-router";
import { layoutRouter } from "./layout/layout-router";
import { organizationRouter } from "./organization/organization-router";
import { createTRPCRouter } from "./trpc";
import { userRouter } from "./user/user-router";
import { versionRouter } from "./version/version-router";
import { waitlistRouter } from "./waitlist/waitlist-router";

export const appRouter = createTRPCRouter({
  waitlist: waitlistRouter,
  organization: organizationRouter,
  document: documentRouter,
  comment: commentRouter,
  file: fileRouter,
  layout: layoutRouter,
  user: userRouter,
  version: versionRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
