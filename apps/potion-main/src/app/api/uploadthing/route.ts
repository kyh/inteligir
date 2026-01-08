import { createRouteHandler } from 'uploadthing/next';

import { ourFileRouter } from '@/components/editor/uploadthing-app';

export const { GET, POST } = createRouteHandler({
  router: ourFileRouter,
});
