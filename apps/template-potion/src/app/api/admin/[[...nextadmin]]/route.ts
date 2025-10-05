import { createHandler } from '@premieroctet/next-admin/appHandler';

import { adminOptions } from '@/app/(dynamic)/(admin)/admin/[[...nextadmin]]/admin-options';
import { prisma } from '@/server/db';

const { run } = createHandler({
  apiBasePath: '/api/admin',
  options: adminOptions,
  prisma,
}) as any;

export { run as DELETE, run as GET, run as POST, run as PUT };
