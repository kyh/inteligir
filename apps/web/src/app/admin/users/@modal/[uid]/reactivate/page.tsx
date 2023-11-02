import { use } from "react";
import { redirect } from "next/navigation";
import getSupabaseServerClient from "@/lib/supabase/server-client";
import AdminGuard from "@/app/admin/components/admin-guard";
import ReactivateUserModal from "@/app/admin/components/reactivate-user-modal";

type Params = {
  params: {
    uid: string;
  };
};

const ReactivateUserModalPage = ({ params }: Params) => {
  const client = getSupabaseServerClient({ admin: true });
  const { data, error } = use(client.auth.admin.getUserById(params.uid));

  if (!data || error) {
    throw new Error(`User not found`);
  }

  const user = data.user;
  const isActive = !("banned_until" in user) || user.banned_until === "none";

  if (isActive) {
    redirect(`/admin/users`);
  }

  return <ReactivateUserModal user={user} />;
};

export default AdminGuard(ReactivateUserModalPage);
