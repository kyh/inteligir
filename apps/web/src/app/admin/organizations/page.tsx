import { use } from "react";
import { getOrganizations } from "@/app/admin/organizations/queries";
import getPageFromQueryParams from "@/app/admin/utils/get-page-from-query-param";
import getSupabaseServerClient from "@/lib/supabase/server-client";
import AppContainer from "@/app/dashboard/[organization]/components/AppContainer";
import AdminHeader from "@/app/admin/components/AdminHeader";
import AdminGuard from "@/app/admin/components/AdminGuard";
import OrganizationsTable from "@/app/admin/organizations/components/OrganizationsTable";
import { TextFieldInput } from "ui/components/TextField";
import configuration from "@/configuration";

type OrganizationsAdminPageProps = {
  searchParams: {
    page?: string;
    search?: string;
  };
};

export const metadata = {
  title: `Organizations | ${configuration.site.siteName}`,
};

const OrganizationsAdminPage = ({
  searchParams,
}: OrganizationsAdminPageProps) => {
  const page = getPageFromQueryParams(searchParams.page);
  const client = getSupabaseServerClient({ admin: true });
  const perPage = 20;
  const search = searchParams.search || "";

  const { organizations, count } = use(getOrganizations(client, search, page));
  const pageCount = count ? Math.ceil(count / perPage) : 0;

  return (
    <div className="flex flex-1 flex-col">
      <AdminHeader>Manage Organizations</AdminHeader>

      <AppContainer>
        <div className="flex flex-col space-y-4">
          <form method="GET">
            <TextFieldInput
              defaultValue={search}
              name="search"
              placeholder="Search Organization..."
            />
          </form>

          <OrganizationsTable
            organizations={organizations}
            page={page}
            pageCount={pageCount}
            perPage={perPage}
          />
        </div>
      </AppContainer>
    </div>
  );
};

export default AdminGuard(OrganizationsAdminPage);
