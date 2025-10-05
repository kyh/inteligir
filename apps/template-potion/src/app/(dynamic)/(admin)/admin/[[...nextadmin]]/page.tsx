import type { PageProps } from '@/lib/navigation/next-types';

import { NextAdmin } from '@premieroctet/next-admin';
import { getNextAdminProps } from '@premieroctet/next-admin/appRouter';

import { AdminGuard } from '@/components/auth/rsc/auth-redirect';
import { prisma } from '@/server/db';
import { trpc } from '@/trpc/server';

import { adminOptions } from './admin-options';

export default function Page(props: PageProps) {
  return (
    <AdminGuard>
      <NextAdminPage {...props} />
    </AdminGuard>
  );
}

async function NextAdminPage(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;

  const currentUser = (await trpc.layout.app()).currentUser;
  const adminProps = await getNextAdminProps({
    apiBasePath: '/api/admin',
    basePath: '/admin',
    options: adminOptions,
    params: params.nextadmin,
    prisma,
    searchParams,
  });

  return (
    <NextAdmin
      {...adminProps}
      user={{
        data: {
          name: currentUser.name!,
          // picture: currentUser.profileImageUrl!,
        },
      }}
    />
  );
}
