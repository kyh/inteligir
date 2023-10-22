import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import isUserSuperAdmin from "@/app/admin/utils/is-user-super-admin";
import AdminSidebar from "@/app/admin/components/admin-sidebar";
import AdminProviders from "@/app/admin/components/admin-providers";

const AdminLayout = async ({ children }: React.PropsWithChildren) => {
  const isAdmin = await isUserSuperAdmin();

  if (!isAdmin) {
    notFound();
  }

  const csrfToken = headers().get("X-CSRF-Token");
  const collapsed = cookies().get("sidebarCollapsed")?.value === "true";

  return (
    <AdminProviders collapsed={collapsed} csrfToken={csrfToken}>
      <div className="flex">
        <AdminSidebar />

        {children}
      </div>
    </AdminProviders>
  );
};

export default AdminLayout;
