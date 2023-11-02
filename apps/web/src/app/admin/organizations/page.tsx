import { use } from "react";
import { TextFieldInput } from "@inteligir/ui/text-field";
import { getOrganizations } from "@/app/admin/organizations/queries";
import getPageFromQueryParams from "@/lib/utils/get-page-from-query-param";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import AppContainer from "@/app/dashboard/components/app-container";
import AdminHeader from "@/app/admin/components/admin-header";
import AdminGuard from "@/app/admin/components/admin-guard";
import OrganizationsTable from "@/app/admin/components/organizations-table";
import { configuration } from "@/lib/configuration";

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
