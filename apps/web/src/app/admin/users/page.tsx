import { use } from "react";
import getSupabaseServerClient from "@/lib/supabase/server-client";
import { getUsers } from "@/app/admin/users/queries";
import type UserData from "@/features/users/user-data";
import getPageFromQueryParams from "@/app/admin/utils/get-page-from-query-param";
import AppContainer from "@/app/dashboard/[organization]/components/app-container";
import AdminHeader from "@/app/admin/components/admin-header";
import AdminGuard from "@/app/admin/components/admin-guard";
import UsersTable from "@/app/admin/users/components/users-table";
import { configuration } from "@/lib/configuration";

type UsersAdminPageProps = {
  searchParams: {
    page?: string;
  };
};

export const metadata = {
  title: `Users | ${configuration.site.siteName}`,
};

const UsersAdminPage = ({ searchParams }: UsersAdminPageProps) => {
  const page = getPageFromQueryParams(searchParams.page);
  const perPage = 20;
  const { users, total } = use(loadUsers(page, perPage));
  const pageCount = Math.ceil(total / perPage);

  return (
    <div className="flex flex-1 flex-col">
      <AdminHeader>Users</AdminHeader>

      <AppContainer>
        <UsersTable
          page={page}
          pageCount={pageCount}
          perPage={perPage}
          users={users}
        />
      </AppContainer>
    </div>
  );
};

export default AdminGuard(UsersAdminPage);

const loadAuthUsers = async (page = 1, perPage = 20) => {
  const client = getSupabaseServerClient({ admin: true });

  const response = await client.auth.admin.listUsers({
    page,
    perPage,
  });

  if (response.error) {
    throw response.error;
  }

  return response.data;
};

const loadUsers = async (page = 1, perPage = 20) => {
  const { users: authUsers, total } = await loadAuthUsers(page, perPage);

  const ids = authUsers.map((user) => user.id);
  const usersData = await getUsers(ids);

  const users = authUsers
    .map((user) => {
      const data = usersData.find((u) => u.id === user.id) as UserData;
      const banDuration =
        "banned_until" in user ? (user.banned_until as string) : "none";

      return {
        id: user.id,
        email: user.email,
        phone: user.phone,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        lastSignInAt: user.last_sign_in_at,
        banDuration,
        data,
      };
    })
    .filter(Boolean);

  return {
    total,
    users,
  };
};
