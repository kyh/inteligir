import { use } from "react";
import getSupabaseServerClient from "@/lib/supabase/server-client";
import BanUserModal from "../../../../components/ban-user-modal";
import AdminGuard from "@/app/admin/components/admin-guard";

type Params = {
  params: {
    uid: string;
  };
};

const BanUserModalPage = ({ params }: Params) => {
  const client = getSupabaseServerClient({ admin: true });
  const { data, error } = use(client.auth.admin.getUserById(params.uid));

  if (!data || error) {
    throw new Error(`User not found`);
  }

  const user = data.user;
  const isBanned = "banned_until" in user && user.banned_until !== "none";

  if (isBanned) {
    throw new Error(`The user is already banned`);
  }

  return <BanUserModal user={user} />;
};

export default AdminGuard(BanUserModalPage);
