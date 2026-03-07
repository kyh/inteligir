import type { FileRouter } from 'uploadthing/next';

import { createUploadthing } from 'uploadthing/next';
import { UploadThingError } from 'uploadthing/server';

import { auth } from '@repo/api/auth/auth';
import { db } from '@repo/db/drizzle-client';
import { file } from '@repo/db/drizzle-schema';
import { user } from '@repo/db/drizzle-schema-auth';
import { eq, sum } from '@repo/db';

const f = createUploadthing();

// FileRouter for your app, can contain multiple FileRoutes
export const ourFileRouter = {
  // Define as many FileRoutes as you like, each with a unique routeSlug
  editorUploader: f(['image', 'text', 'blob', 'pdf', 'video', 'audio'])
    // Set permissions and file types for this FileRoute
    .middleware(async ({ req }) => {
      // This code runs on your server before upload
      const sessionData = await auth.api.getSession({ headers: req.headers });
      const sessionUser = sessionData?.user;

      // If you throw, the user will not be able to upload
      if (!sessionUser) throw new UploadThingError('Unauthorized');

      const [userData] = await db
        .select({ uploadLimit: user.uploadLimit })
        .from(user)
        .where(eq(user.id, sessionUser.id));

      if (!userData) throw new UploadThingError('Unauthorized');

      const [filesData] = await db
        .select({ totalSize: sum(file.size) })
        .from(file)
        .where(eq(file.userId, sessionUser.id));

      const uploadedBytes = Number(filesData?.totalSize ?? 0);

      // 500MB
      if (uploadedBytes > userData.uploadLimit)
        throw new UploadThingError('Reached the maximum upload limit.');

      // Whatever is returned here is accessible in onUploadComplete as `metadata`
      return { uploadedBytes, userId: sessionUser.id };
    })
    .onUploadComplete(({ file, metadata }) => {
      // This code RUNS ON YOUR SERVER after upload

      // !!! Whatever is returned here is sent to the clientside `onClientUploadComplete` callback
      return {
        key: file.key,
        name: file.name,
        size: file.size,
        type: file.type,
        uploadedBy: metadata.userId,
        url: file.url,
      };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
