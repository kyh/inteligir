import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import AppContainer from "@/app/dashboard/components/app-container";
import AdminHeader from "@/app/admin/components/admin-header";
import AdminGuard from "@/app/admin/components/admin-guard";
import AdminDashboard from "@/app/admin/components/admin-dashboard";

export const metadata = {
  title: `Admin | Inteligir`,
};

const AdminPage = async () => {
  const data = await loadData();

  return (
    <div className="flex flex-1 flex-col">
      <AdminHeader>Admin</AdminHeader>
      <AppContainer>
        <AdminDashboard data={data} />
      </AppContainer>
    </div>
  );
};

export default AdminGuard(AdminPage);

const loadData = async () => {
  const client = getSupabaseServerClient({ admin: true });

  const { count: usersCount } = await client.from("users").select("*", {
    count: "exact",
    head: true,
  });

  const { count: organizationsCount } = await client
    .from("organizations")
    .select("*", {
      count: "exact",
      head: true,
    });

  const { count: activeSubscriptions } = await client
    .from("subscriptions")
    .select(`*`, {
      count: "exact",
      head: true,
    })
    .eq("status", "active");

  const { count: trialSubscriptions } = await client
    .from("subscriptions")
    .select(`*`, {
      count: "exact",
      head: true,
    })
    .eq("status", "trialing");

  return {
    usersCount: usersCount || 0,
    organizationsCount: organizationsCount || 0,
    activeSubscriptions: activeSubscriptions || 0,
    trialSubscriptions: trialSubscriptions || 0,
  };
};
