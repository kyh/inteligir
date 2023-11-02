import { use } from "react";
import Link from "next/link";
import { ChevronRightMini } from "@inteligir/icons";
import { getMembershipsByOrganizationUid } from "@/app/admin/organizations/queries";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import getPageFromQueryParams from "@/lib/utils/get-page-from-query-param";
import AppContainer from "@/app/dashboard/components/app-container";
import AdminHeader from "@/app/admin/components/admin-header";
import OrganizationsMembersTable from "@/app/admin/components/organizations-members-table";
import { configuration } from "@/lib/configuration";

type AdminMembersPageParams = {
  params: {
    uid: string;
  };

  searchParams: {
    page?: string;
  };
};

export const metadata = {
  title: `Members | ${configuration.site.siteName}`,
};

const AdminMembersPage = (params: AdminMembersPageParams) => {
  const adminClient = getSupabaseServerClient({ admin: true });
  const uid = params.params.uid;
  const perPage = 20;
  const page = getPageFromQueryParams(params.searchParams.page);

  const { data: memberships, count } = use(
    getMembershipsByOrganizationUid(adminClient, { uid, page, perPage }),
  );

  const pageCount = count ? Math.ceil(count / perPage) : 0;

  return (
    <div className="flex flex-1 flex-col">
      <AdminHeader>Manage Members</AdminHeader>

      <AppContainer>
        <div className="flex flex-col space-y-4">
          <Breadcrumbs />

          <OrganizationsMembersTable
            memberships={memberships}
            page={page}
            pageCount={pageCount}
            perPage={perPage}
          />
        </div>
      </AppContainer>
    </div>
  );
};

export default AdminMembersPage;

const Breadcrumbs = () => {
  return (
    <div className="flex items-center space-x-2 p-2 text-xs">
      <div className="flex items-center space-x-1.5">
        <Link href="/admin">Admin</Link>
      </div>

      <ChevronRightMini className="w-3" />

      <Link href="/admin/organizations">Organizations</Link>

      <ChevronRightMini className="w-3" />

      <span>Members</span>
    </div>
  );
};
