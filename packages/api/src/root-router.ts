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
  comment: commentRouter,
  document: documentRouter,
  file: fileRouter,
  layout: layoutRouter,
  organization: organizationRouter,
  user: userRouter,
  version: versionRouter,
  waitlist: waitlistRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
